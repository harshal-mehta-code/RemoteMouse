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
        'node-mac-permissions'
    ],
  };

  // Build main process
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join('src-electron', 'main.ts')],
    outfile: path.join('dist', 'main.js'),
  });

  // Build server logic
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join('src-electron', 'server', 'index.ts')],
    outfile: path.join('dist', 'server', 'index.js'),
  });

  // Build the context-isolation preload bridge
  await esbuild.build({
    ...commonOptions,
    entryPoints: [path.join('src-electron', 'preload.ts')],
    outfile: path.join('dist', 'preload.js'),
  });

  // Build frontend client
  await esbuild.build({
    ...commonOptions,
    platform: 'browser',
    entryPoints: [path.join('src-shared', 'public', 'client.ts')],
    outfile: path.join('dist', 'public', 'client.js'),
  });

  // Copy public assets
  const publicSrc = path.join('src-shared', 'public');
  const distPublic = path.join('dist', 'public');
  if (!fs.existsSync(distPublic)) {
    fs.mkdirSync(distPublic, { recursive: true });
  }
  
  const publicFiles = fs.readdirSync(publicSrc);
  for (const file of publicFiles) {
    // Skip sources and anything esbuild already emitted — copying a stale
    // client.js here would clobber the bundle built moments ago.
    if (file.endsWith('.ts') || file === 'client.js') continue;
    fs.copyFileSync(path.join(publicSrc, file), path.join(distPublic, file));
  }

  // Copy other necessary files. The popover is loaded from dist/public/ so its
  // relative <script> tags resolve; only the tray icon lives at the dist root.
  fs.copyFileSync(path.join('assets', 'iconTemplate.png'), path.join('dist', 'iconTemplate.png'));
  
  // Create a minimal package.json for the dist folder
  const originalPkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const distPkg = {
    name: originalPkg.name,
    version: originalPkg.version,
    main: 'main.js',
    dependencies: {
        'menubar': originalPkg.dependencies.menubar,
        'qrcode': originalPkg.dependencies.qrcode,
        'robotjs': originalPkg.dependencies.robotjs,
        'ws': originalPkg.dependencies.ws
    },
    optionalDependencies: {
        'node-mac-permissions': originalPkg.optionalDependencies['node-mac-permissions']
    }
  };
  fs.writeFileSync(path.join('dist', 'package.json'), JSON.stringify(distPkg, null, 2));

  console.log('Build complete! Output in dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
