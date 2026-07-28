/*
 * Gera uma chave de API do Pugicordium.
 *
 * Uso, dentro do container:
 *   node scripts/pugicordium-chave.js "nome da chave" brews:ler,brews:escrever,render:medir
 *
 * A chave aparece UMA vez. O banco guarda só o hash — nem o servidor
 * consegue recuperá-la depois. Perdeu, gera outra e revoga a antiga.
 */

import mongoose from 'mongoose';

import config from '../server/config.js';
import DB     from '../server/db.js';
import { gerarChave, ESCOPOS, Chave } from '../server/pugicordium/chaves.js';

const nome = process.argv[2];
const escoposArg = process.argv[3];

if(!nome) {
	console.error('Uso: node scripts/pugicordium-chave.js "<nome>" [escopos separados por vírgula]');
	console.error('Escopos válidos:', Object.values(ESCOPOS).join(', '));
	process.exit(1);
}

const escopos = escoposArg
	? escoposArg.split(',').map((e)=>e.trim()).filter(Boolean)
	: Object.values(ESCOPOS);

const invalidos = escopos.filter((e)=>!Object.values(ESCOPOS).includes(e));

if(invalidos.length) {
	console.error('Escopo desconhecido:', invalidos.join(', '));
	console.error('Válidos:', Object.values(ESCOPOS).join(', '));
	process.exit(1);
}

await DB.connect(config);

const { valor, prefixo } = await gerarChave({ nome, escopos });

console.log('\n  Chave criada. Ela aparece uma vez só.\n');
console.log(`  nome    : ${nome}`);
console.log(`  escopos : ${escopos.join(', ')}`);
console.log(`  prefixo : ${prefixo}`);
console.log(`\n  ${valor}\n`);
console.log('  Envie no header:  X-Pugicordium-Key: <chave>\n');

const total = await Chave.countDocuments({ revogada: false });

console.log(`  Chaves ativas nesta instância: ${total}\n`);

await mongoose.disconnect();
