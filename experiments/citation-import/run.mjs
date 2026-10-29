import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { SYSTEM, digest, validateDataset, validatePrediction, baseline, score, aggregate } from './core.mjs';
import { createAuditModel } from '../../lib/models/auditModel.js';
import { readManuscript } from '../../lib/documents/auditDocument.js';
export function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw Error(`Unexpected argument: ${argv[i]}`);
    result[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return result;
}
function command(config, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command[0], config.command.slice(1), { stdio: ['pipe','pipe','pipe'], shell: false });
    let output = '', done = false;
    const finish = (error, result) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(Error('Adapter timed out.')); }, config.timeoutMs || 120000);
    child.on('error', () => finish(Error('Adapter could not be started.')));
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => { output += chunk; if (Buffer.byteLength(output) > 2_000_000) { child.kill('SIGKILL'); finish(Error('Adapter output exceeded 2 MB.')); } });
    // Drain, but do not persist stderr: provider errors may include credentials.
    child.stderr.resume();
    child.on('close', code => {
      if (code !== 0) return finish(Error(`Adapter exited with status ${code}.`));
      try { finish(null, JSON.parse(output)); } catch { finish(Error('Adapter stdout was not a single JSON object.')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
function number(value, name, max = Infinity) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max || !Number.isInteger(n)) throw Error(`Invalid ${name}.`);
  return n;
}
export async function run(options) {
  const datasetPath = path.resolve(options.dataset || 'experiments/citation-import/data/smoke.json');
  const data = validateDataset(JSON.parse(await readFile(datasetPath, 'utf8')));
  const config = JSON.parse(await readFile(options.config || 'experiments/citation-import/configs/baseline.json', 'utf8'));
  if (!['baseline','command','anthropic'].includes(config.adapter) || !['local','cloud'].includes(config.location) || !config.name) throw Error('Invalid adapter config.');
  if (config.adapter === 'anthropic' && config.location !== 'cloud') throw Error('Anthropic must be declared cloud.');
  if (config.adapter === 'command' && (!Array.isArray(config.command) || !config.command.length || config.command.some(s => typeof s !== 'string'))) throw Error('command must be an argv array.');
  if (config.location === 'cloud' && !options['allow-cloud']) throw Error('Cloud calls require --allow-cloud.');
  const split = options.split || 'test', variant = options.variant || 'clean_text';
  if (!['train','validation','test','all'].includes(split)) throw Error('Unknown split.');
  const limit = number(options.limit || 20, 'limit', 1000), repeats = number(options.repeats || 1, 'repeats', 20);
  const selected = data.filter(d => split === 'all' || d.split === split).slice(0, limit);
  if (!selected.length) throw Error('No documents selected.');
  if (config.location === 'cloud' && selected.some(d => d.privacy === 'private')) throw Error('Private manuscripts are blocked from cloud runs.');
  if (selected.some(d => !d.inputs[variant])) throw Error(`Missing input variant: ${variant}`);
  const model = config.adapter === 'anthropic' ? createAuditModel({model: config.model || process.env.ANTHROPIC_MODEL}) : null;
  if (model && !model.configured) throw Error('Set ANTHROPIC_API_KEY and a model in config or ANTHROPIC_MODEL. No calls made.');
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const out = path.resolve(options.out || `experiments/citation-import/results/${config.name}-${variant}-${stamp}.json`);
  await mkdir(path.dirname(out), {recursive:true});
  // Reserve output before any potentially billable call; never silently overwrite a run.
  await writeFile(out, '', {flag:'wx'});
  const records = [];
  const report = { schemaVersion:1, startedAt:new Date().toISOString(), datasetHash:digest(data), promptHash:digest(SYSTEM),
    configHash:digest(config), config:{name:config.name,adapter:config.adapter,location:config.location,model:config.model || null, checkpoint:config.checkpoint || null, precision:config.precision || null, runtime:config.runtime || null},
    split,variant,repeats, syntheticOnly:selected.every(d=>d.privacy==='synthetic'), records,
    notice:'Synthetic fixtures validate plumbing only. No real-world SFT or hosting claim follows from smoke scores. Each command starts a fresh process; use an adapter to a persistent server to measure warm inference.' };
  const persist = async () => { report.summary = aggregate(records); await writeFile(out, JSON.stringify(report,null,2)+'\n'); };
  await persist();
  for (let repeat = 0; repeat < repeats; repeat++) for (const d of selected) {
    const started = performance.now();
    let text = d.inputs[variant], prediction = {references:[]}, error = null, usage = null, preprocessingMs = 0, inputHash = null;
    try {
      if (variant === 'source_file') {
        const file = path.resolve(path.dirname(datasetPath), text);
        const bytes = await readFile(file);
        text = (await readManuscript({file:{name:path.basename(file),base64:bytes.toString('base64')}})).text;
        preprocessingMs = performance.now() - started;
      }
      if (text.length > 100000) throw Error('Input exceeds 100,000 characters.');
      inputHash = digest(text);
      // Explicit allowlist: no gold labels, work IDs, provenance, or split reach a model.
      const request = {system:SYSTEM, text};
      const result = config.adapter === 'baseline' ? {prediction:baseline(text)} : config.adapter === 'anthropic' ? {prediction:await model.json(SYSTEM,{manuscript:text})} : await command(config,request);
      prediction = validatePrediction(result.prediction);
      if (result.usage) {
        usage = {};
        for (const key of ['inputTokens','outputTokens','billedUsd','energyWh']) if (result.usage[key] != null) {
          if (!Number.isFinite(result.usage[key]) || result.usage[key] < 0) throw Error(`Invalid usage.${key}`);
          usage[key] = result.usage[key];
        }
      }
    } catch (e) {
      // Invalid/truncated output remains a failed attempt and contributes misses.
      error = e.message; prediction = {references:[]}; usage = null;
    }
    records.push({id:d.id,groupId:d.groupId,repeat,inputHash,elapsedMs:performance.now()-started,preprocessingMs,error,usage,prediction,score:score(d.gold,prediction)});
    await persist();
    console.log(`${d.id} repeat=${repeat+1}: ${error ? 'FAILED' : 'ok'} F1=${records.at(-1).score.f1.toFixed(3)}`);
  }
  report.finishedAt = new Date().toISOString(); await persist(); console.log(out); return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  run(args(process.argv.slice(2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
