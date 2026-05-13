const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  const commonOptions = {
    bundle: true,
    minify: true,
    platform: 'node',
    external: [
        'electron',
        'robotjs',
        'node-mac-permissions',
        'mouse-macos'
    ],
  };

  // Build main process
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['main.js'],
    outfile: 'dist/main.js',
  });

  // Build server logic
  await esbuild.build({
    ...commonOptions,
    entryPoints: ['server/index.js'],
    outfile: 'dist/server/index.js',
  });

  // Copy public assets
  if (!fs.existsSync('dist/public')) {
    fs.mkdirSync('dist/public', { recursive: true });
  }
  
  const publicFiles = fs.readdirSync('public');
  for (const file of publicFiles) {
    fs.copyFileSync(path.join('public', file), path.join('dist/public', file));
  }

  // Copy other necessary files
  fs.copyFileSync('tray-popover.html', 'dist/tray-popover.html');
  fs.copyFileSync('iconTemplate.png', 'dist/iconTemplate.png');
  
  // Create a minimal package.json for the dist folder
  const originalPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const distPkg = {
    name: originalPkg.name,
    version: originalPkg.version,
    main: 'main.js',
    dependencies: {
        'menubar': originalPkg.dependencies.menubar,
        'mouse-macos': originalPkg.dependencies['mouse-macos'],
        'node-mac-permissions': originalPkg.dependencies['node-mac-permissions'],
        'qrcode': originalPkg.dependencies.qrcode,
        'robotjs': originalPkg.dependencies.robotjs,
        'ws': originalPkg.dependencies.ws
    }
  };
  fs.writeFileSync('dist/package.json', JSON.stringify(distPkg, null, 2));

  console.log('Build complete! Output in dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
