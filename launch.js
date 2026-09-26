'use strict'
// Electron must not run in Node.js-only mode
delete process.env.ELECTRON_RUN_AS_NODE
const path = require('path')
const { spawn } = require('child_process')
const electron = require('electron') // returns path to electron.exe

const args = ['.', ...process.argv.slice(2)]
const child = spawn(electron, args, { stdio: 'inherit', env: process.env })
child.on('close', code => process.exit(code ?? 0))
