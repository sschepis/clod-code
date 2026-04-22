const path = require('path');

async function start() {
    try {
        const { SentientServer } = require('@sschepis/alephnet-node/lib/app/server.js');
        const port = parseInt(process.env.ALEPHNET_PORT || '31337', 10);
        // Ensure dataPath is an absolute path within the workspace
        const dataPath = process.env.ALEPHNET_DATA_PATH || path.join(process.cwd(), '.obotovs', 'alephnet');
        
        console.log(`[AlephNet Runner] Starting server on port ${port} with dataPath: ${dataPath}`);
        
        const server = new SentientServer({ 
            port, 
            dataPath 
        });
        
        await server.start();
        console.log(`[AlephNet Runner] Server successfully started.`);
    } catch (error) {
        console.error(`[AlephNet Runner] Failed to start server:`, error);
        process.exit(1);
    }
}

start();
