const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = path.join(__dirname, 'statusline-subagent.js');
const { render, dw } = require(SCRIPT);

const NOW = 1_800_000_000_000;

function task(over = {}) {
  return {
    id: 'a1',
    name: 'researcher',
    type: 'local_agent',
    status: 'running',
    model: 'claude-opus-5[1m]',
    effort: 'xhigh',
    contextWindowSize: 1_000_000,
    tokenCount: 47_000,
    tokenSamples: [1000, 12_000, 30_000, 47_000],
    startTime: NOW - 372_000,
    ...over,
  };
}

const contents = (tasks, columns = 120) =>
  render({ columns, tasks }, NOW).map((l) => JSON.parse(l).content);

test('одна NDJSON-строка на задачу, с id и content', () => {
  const lines = render({ columns: 120, tasks: [task(), task({ id: 'b2' })] }, NOW);
  assert.strictEqual(lines.length, 2);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepStrictEqual(parsed.map((p) => p.id), ['a1', 'b2']);
  parsed.forEach((p) => assert.strictEqual(typeof p.content, 'string'));
});

test('строка несёт модель и effort — то, чего нет в дефолтном ряду', () => {
  const [c] = contents([task()]);
  assert.match(c, /Opus5\(1m\) xhigh/);
});

test('токены показаны вместе с размером контекстного окна', () => {
  const [c] = contents([task()]);
  assert.match(c, /47k\/1\.0m/);
});

test('спарклайн отличает застойного агента от активного', () => {
  const [stalled] = contents([task({ tokenSamples: [500, 500, 500, 500] })]);
  assert.match(stalled, /▁▁▁/);
  const [busy] = contents([task({ tokenSamples: [0, 10, 100, 1000] })]);
  assert.match(busy, /█/);
});

test('кириллица, CJK, эмодзи и диакритика не ломают выравнивание колонки имени', () => {
  const cs = contents([
    task({ id: '1', name: 'plain-name' }),
    task({ id: '2', name: 'агент-исследователь' }),
    task({ id: '3', name: '😀 emoji ❤️ агент' }),
    task({ id: '4', name: '日本語エージェント' }),          // .length 9, ширина 18
    task({ id: '5', name: 'cafe\u0301-agent' }),  // .length 11, ширина 10 (комб. акут)
    task({ id: '6', name: '\u{1F44D}\u{1F3FD} и \u{1F468}‍\u{1F469}‍\u{1F467} агент' }),
  ]);
  const widths = new Set(cs.map(dw));
  assert.strictEqual(widths.size, 1, `рассинхрон ширин: ${[...widths].join(', ')}`);
});

test('пустой список задач не печатает ничего', () => {
  assert.deepStrictEqual(render({ columns: 120, tasks: [] }, NOW), []);
});

test('отсутствующие model/effort/startTime не протекают как undefined', () => {
  const [c] = contents([
    { id: 'x', name: 'bare', status: 'running', tokenCount: 0, tokenSamples: [] },
  ]);
  assert.doesNotMatch(c, /undefined|null|NaN/);
  assert.match(c, /bare/);
});

test('строка не шире выданных columns', () => {
  const [c] = contents([task({ name: 'очень-длинное-имя-агента-которое-точно-не-влезает' })], 40);
  assert.ok(dw(c) <= 39, `ширина ${dw(c)} > 39`);
});

test('статус печатается только когда он не running', () => {
  const [running] = contents([task({ status: 'running' })]);
  assert.doesNotMatch(running, /running/);
  const [paused] = contents([task({ status: 'paused' })]);
  assert.match(paused, /paused/);
});

test('content никогда не пустой — пустой скрывает ряд в панели', () => {
  const cs = contents([{ id: 'x' }, { id: 'y', name: '   ' }]);
  cs.forEach((c) => assert.notStrictEqual(c, ''));
});

test('dw: кириллица — колонка на символ, CJK и эмодзи — две', () => {
  assert.strictEqual(dw('abc'), 3);
  assert.strictEqual(dw('привет'), 6);
  assert.strictEqual(dw('日本語'), 6);
  assert.strictEqual(dw('😀'), 2);
  assert.strictEqual(dw('❤️'), 2);
  assert.strictEqual(dw('cafe\u0301'), 4);
});

test('dw: составное эмодзи — один глиф, а не сумма частей', () => {
  assert.strictEqual(dw('\u{1F44D}\u{1F3FD}'), 2);                          // + модификатор тона кожи
  assert.strictEqual(dw('\u{1F468}‍\u{1F469}‍\u{1F467}'), 2);     // ZWJ-семья
  assert.strictEqual(dw('\u{1F1F7}\u{1F1FA}'), 2);                          // флаг: пара regional indicator
  assert.strictEqual(dw('1️⃣'), 2);                               // keycap
});

test('dw: эмодзи из блоков вне 0x1f300–0x1f64f тоже широкие', () => {
  assert.strictEqual(dw('\u{1F680}'), 2);   // транспорт, 0x1f680–0x1f6ff
  assert.strictEqual(dw('\u{1F9E0}'), 2);   // доп. символы, 0x1f900–0x1f9ff
});

test('битый stdin не роняет скрипт и ничего не печатает', () => {
  const out = execFileSync('node', [SCRIPT], { input: 'not json at all', encoding: 'utf8' });
  assert.strictEqual(out, '');
});

test('сквозной прогон через stdin отдаёт валидный NDJSON', () => {
  const out = execFileSync('node', [SCRIPT], {
    input: JSON.stringify({ columns: 120, tasks: [task()] }),
    encoding: 'utf8',
  });
  const lines = out.trim().split('\n');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(JSON.parse(lines[0]).id, 'a1');
});
