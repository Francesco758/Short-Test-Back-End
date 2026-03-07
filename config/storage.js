const fs = require('fs-extra');
const path = require('path');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

function filePath(name){
  return path.join(DATA_DIR, `${name}.json`);
}

async function read(name){
  const p = filePath(name);
  try {
    const exists = await fs.pathExists(p);
    if(!exists) return [];
    const text = await fs.readFile(p, 'utf8');
    return JSON.parse(text || '[]');
  } catch(err){
    console.error('read error', err);
    return [];
  }
}

async function write(name, data){
  const p = filePath(name);
  await fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { read, write };
