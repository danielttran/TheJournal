const { execSync } = require('child_process');
const path = require('path');

console.log('Installing better-sqlite3 for Electron...');

try {
    // Define the environment variables for Electron rebuild
    const env = {
        ...process.env,
        // Force use of Electron's headers
        npm_config_runtime: 'electron',
        npm_config_target: '33.2.1', // The version of Electron we are using
        npm_config_disturl: 'https://electronjs.org/headers',
        // Ensure we build for the correct arch
        npm_config_arch: 'x64'
    };

    // Run npm install for better-sqlite3 specifically
    execSync('npm install better-sqlite3@12.6.2 --force', {
        cwd: path.resolve(__dirname, '..'),
        env: env,
        stdio: 'inherit'
    });

    console.log('Successfully installed better-sqlite3 for Electron.');
} catch (error) {
    console.error('Failed to install better-sqlite3:', error);
    process.exit(1);
}
