import {build} from 'esbuild';
await build({entryPoints:['main.ts'],bundle:true,platform:'browser',format:'cjs',target:'es2020',external:['obsidian'],outfile:'main.js'});
await build({entryPoints:['core.ts'],bundle:true,platform:'node',format:'cjs',outfile:'core.cjs'});

await build({entryPoints:['navigation.ts'],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],outfile:'navigation.cjs'});

await build({entryPoints:['source.ts'],bundle:true,platform:'node',format:'cjs',outfile:'source.cjs'});

await build({entryPoints:['relay-client.ts'],bundle:true,platform:'node',format:'cjs',outfile:'relay-client.cjs'});

await build({entryPoints:['identity.ts'],bundle:true,platform:'node',format:'cjs',outfile:'identity.cjs'});

await build({entryPoints:['ui.ts'],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],outfile:'ui.cjs'});
