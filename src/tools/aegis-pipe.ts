import { z } from "zod";
import Parser from "web-tree-sitter"; // or 'tree-sitter' for Node.js environments

// ==========================================
// 1. ZOD SCHEMAS & TYPE INFERENCE
// ==========================================

export const ExecutionModeSchema = z.enum(["dry_run", "apply"]);

export const ASTLocatorSchema = z.object({
  type: z.enum(["function_definition", "class_definition", "variable_declaration", "import_statement"]),
  name: z.string().min(1, "Name cannot be empty"),
  scope: z.enum(["global"]).or(z.string()).optional().default("global"),
});

// --- Step Schemas ---
export const RegexReplaceStepSchema = z.object({
  step: z.literal("regex_replace"),
  config: z.object({
    pattern: z.string(),
    replacement: z.string(),
  }),
});

export const ApplyPatchStepSchema = z.object({
  step: z.literal("apply_patch"),
  config: z.object({
    patch_content: z.string(),
  }),
});

export const ASTRenameSymbolStepSchema = z.object({
  step: z.literal("ast_rename_symbol"),
  config: z.object({
    locator: ASTLocatorSchema,
    new_name: z.string(),
    update_references: z.boolean().default(true),
  }),
});

export const ASTInsertNodeStepSchema = z.object({
  step: z.literal("ast_insert_node"),
  config: z.object({
    locator: ASTLocatorSchema,
    insertion_point: z.enum(["parameter_list", "body_start", "body_end", "before_node", "after_node"]),
    content: z.string(),
  }),
});

export const ASTReplaceNodeStepSchema = z.object({
  step: z.literal("ast_replace_node"),
  config: z.object({
    locator: ASTLocatorSchema,
    new_content: z.string(),
  }),
});

// --- The Master Discriminated Union ---
export const PipelineStepSchema = z.discriminatedUnion("step", [
  RegexReplaceStepSchema,
  ApplyPatchStepSchema,
  ASTRenameSymbolStepSchema,
  ASTInsertNodeStepSchema,
  ASTReplaceNodeStepSchema,
]);

export const PipelineRequestSchema = z.object({
  target_file: z.string(),
  execution_mode: ExecutionModeSchema,
  pipeline: z.array(PipelineStepSchema).min(1, "Pipeline must contain at least one step"),
});

// --- TypeScript Types Extracted from Zod ---
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;
export type ASTLocator = z.infer<typeof ASTLocatorSchema>;
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type PipelineRequest = z.infer<typeof PipelineRequestSchema>;

// --- Response Types ---
export type ErrorCode = "PARSE_ERROR" | "NODE_NOT_FOUND" | "AMBIGUOUS_LOCATOR" | "PATCH_REJECTED" | "VALIDATION_FAILED";

export interface ErrorReport {
  code: ErrorCode;
  message: string;
  context: {
    file: string;
    attempted_locator?: ASTLocator;
    [key: string]: unknown;
  };
  recovery_hints: string[];
}

export interface StepResult {
  step_index: number;
  status: "success" | "failure";
  mutations?: number;
  message?: string;
}

export interface PipelineResponse {
  status: "success" | "partial_failure" | "fatal_error";
  pipeline_state: "applied" | "reverted" | "dry_run_completed";
  execution_time_ms: number;
  original_state_hash: string;
  final_state_hash?: string;
  unified_diff?: string;
  step_results: StepResult[];
  failed_step_index?: number;
  error_report?: ErrorReport;
}


// ==========================================
// 2. DEPENDENCY INTERFACES
// ==========================================

export interface IFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface IASTManager {
  parse(content: string, language?: any): Parser.Tree | null;
  renameSymbol(tree: Parser.Tree, config: z.infer<typeof ASTRenameSymbolStepSchema>["config"], sourceCode: string): string;
  // insertNode, replaceNode, etc. would go here
}

export interface IUtils {
  generateHash(content: string): string;
  generateUnifiedDiff(original: string, modified: string, filepath: string): string;
  guessLanguage(filepath: string): any; // Returns Tree-sitter language module
}


// ==========================================
// 3. TREE-SITTER IMPLEMENTATION
// ==========================================

export class TreeSitterASTManager implements IASTManager {
  private parser: Parser.Parser;
  private language: any;

  constructor(parser: Parser.Parser, language: any) {
    this.parser = parser;
    this.parser.setLanguage(language);
    this.language = language;
  }

  public parse(content: string): Parser.Tree | null {
    return this.parser.parse(content);
  }

  public renameSymbol(tree: Parser.Tree, config: z.infer<typeof ASTRenameSymbolStepSchema>["config"], sourceCode: string): string {
    let queryString = "";

    if (config.locator.type === "function_definition") {
      queryString = `
        (function_definition
          name: (identifier) @target_name
          (#eq? @target_name "${config.locator.name}")
        )
      `;
    } else {
      throw new PipelineExecutionError({
        code: "PARSE_ERROR",
        message: `Locator type ${config.locator.type} not implemented for renaming.`,
        context: { file: "unknown", attempted_locator: config.locator },
        recovery_hints: ["Use a supported locator type like 'function_definition'."],
      });
    }

    const query = this.language.query(queryString);
    const matches = query.matches(tree.rootNode);

    if (matches.length === 0) {
      throw new PipelineExecutionError({
        code: "NODE_NOT_FOUND",
        message: `Could not find ${config.locator.type} named '${config.locator.name}'`,
        context: { file: "unknown", attempted_locator: config.locator },
        recovery_hints: ["Check if the node was renamed by a previous step.", "Verify the scope."],
      });
    }

    const targetCapture = matches[0].captures.find((c: any) => c.name === "target_name");
    const targetNode = targetCapture!.node;

    return (
      sourceCode.slice(0, targetNode.startIndex) +
      config.new_name +
      sourceCode.slice(targetNode.endIndex)
    );
  }
}


// ==========================================
// 4. CORE EXECUTION ENGINE
// ==========================================

export class PipelineExecutionError extends Error {
  constructor(public report: ErrorReport) {
    super(report.message);
  }
}

export class PipelineEngine {
  constructor(
    private fs: IFileSystem,
    private astManager: IASTManager,
    private utils: IUtils
  ) {}

  public async execute(rawPayload: unknown): Promise<PipelineResponse> {
    const startTime = Date.now();
    let request: PipelineRequest;

    // 1. Strict Input Validation
    try {
      request = PipelineRequestSchema.parse(rawPayload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return this.buildFatalResponse(startTime, "N/A", {
          code: "VALIDATION_FAILED",
          message: "The provided pipeline payload failed schema validation.",
          context: { file: "N/A", issues: error.issues },
          recovery_hints: ["Fix the JSON schema to match the required Typescript interfaces."]
        });
      }
      throw error;
    }

    // 2. Read Target File
    let originalContent: string;
    try {
      originalContent = await this.fs.readFile(request.target_file);
    } catch (e) {
      return this.buildFatalResponse(startTime, "N/A", {
        code: "PARSE_ERROR",
        message: `Could not read target file: ${request.target_file}`,
        context: { file: request.target_file },
        recovery_hints: ["Verify the file path exists.", "Check file permissions."]
      });
    }

    const originalHash = this.utils.generateHash(originalContent);
    let currentContent = originalContent;
    const stepResults: StepResult[] = [];

    // 3. The Execution Loop
    for (let i = 0; i < request.pipeline.length; i++) {
      const step = request.pipeline[i];
      try {
        const { newContent, mutations, message } = await this.dispatchStep(step, currentContent, request.target_file);
        currentContent = newContent;
        stepResults.push({ step_index: i, status: "success", mutations, message });
      } catch (error) {
        // Rollback Handler
        const report = error instanceof PipelineExecutionError
          ? error.report
          : this.createGenericError(error, request.target_file);

        return {
          status: "fatal_error",
          pipeline_state: "reverted",
          execution_time_ms: Date.now() - startTime,
          original_state_hash: originalHash,
          step_results: stepResults,
          failed_step_index: i,
          error_report: report
        };
      }
    }

    // 4. Finalize & Apply
    const finalHash = this.utils.generateHash(currentContent);
    let diff: string | undefined;

    if (request.execution_mode === "dry_run" || currentContent !== originalContent) {
      diff = this.utils.generateUnifiedDiff(originalContent, currentContent, request.target_file);
    }

    if (request.execution_mode === "apply" && currentContent !== originalContent) {
      await this.fs.writeFile(request.target_file, currentContent);
    }

    return {
      status: "success",
      pipeline_state: request.execution_mode === "apply" ? "applied" : "dry_run_completed",
      execution_time_ms: Date.now() - startTime,
      original_state_hash: originalHash,
      final_state_hash: finalHash,
      unified_diff: diff,
      step_results: stepResults
    };
  }

  private async dispatchStep(
    step: PipelineStep,
    content: string,
    filepath: string
  ): Promise<{ newContent: string; mutations: number; message?: string }> {
    
    switch (step.step) {
      case "regex_replace":
        const regex = new RegExp(step.config.pattern, "g");
        const matches = (content.match(regex) || []).length;
        if (matches === 0) {
          throw new PipelineExecutionError({
            code: "PATCH_REJECTED",
            message: `Regex pattern '${step.config.pattern}' found no matches.`,
            context: { file: filepath },
            recovery_hints: ["Check if the target string was modified by a previous step or external process."]
          });
        }
        return { newContent: content.replace(regex, step.config.replacement), mutations: matches };

      case "ast_rename_symbol":
        const lang = this.utils.guessLanguage(filepath);
        const tree = this.astManager.parse(content, lang);
        if (!tree) throw new Error('Failed to parse file for AST rename');
        const updatedContent = this.astManager.renameSymbol(tree, step.config, content);
        return { newContent: updatedContent, mutations: 1, message: `Renamed ${step.config.locator.name} to ${step.config.new_name}` };

      case "apply_patch":
      case "ast_insert_node":
      case "ast_replace_node":
        // Implement other handlers here...
        return { newContent: content, mutations: 1, message: "Step executed (stub)" };

      default:
        throw new Error(`Unhandled step type: ${(step as any).step}`);
    }
  }

  private buildFatalResponse(timeMs: number, hash: string, report: ErrorReport): PipelineResponse {
    return {
      status: "fatal_error",
      pipeline_state: "reverted",
      execution_time_ms: Date.now() - timeMs,
      original_state_hash: hash,
      step_results: [],
      error_report: report
    };
  }

  private createGenericError(error: any, filepath: string): ErrorReport {
    return {
      code: "PARSE_ERROR",
      message: error.message || "An unknown error occurred during execution.",
      context: { file: filepath },
      recovery_hints: ["Review the pipeline configuration for structural errors."]
    };
  }
}