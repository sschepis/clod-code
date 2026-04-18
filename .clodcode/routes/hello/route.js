export async function GET(req, { params }) {
  return Response.json({ 
    message: "Hello from Clodcode routes!",
    timestamp: new Date().toISOString(),
    status: "success"
  });
}