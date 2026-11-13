import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTrace,simulate,capacitySweep,analyze,examples,POLICIES} from '../core.js';
const run = (text, n, policy) => simulate(parseTrace(text), n, policy);

test('trace parsing supports reads, writes, whitespace and comma separators', () => {
  assert.deepEqual(parseTrace('0, 1r\n9999W 3'), [{page:0,write:false},{page:1,write:false},{page:9999,write:true},{page:3,write:false}]);
  for (const text of ['', '-1', '1.5', '10000', '1x', '01', 'Infinity', '1;2', '1 '.repeat(1001)]) assert.throws(() => parseTrace(text));
  assert.throws(() => parseTrace(' '.repeat(12001)));
});
test('canonical FIFO anomaly is 9 faults with 3 frames and 10 with 4', () => {
  assert.equal(run(examples.anomaly,3,'FIFO').faults,9);
  assert.equal(run(examples.anomaly,4,'FIFO').faults,10);
  assert.equal(run(examples.anomaly,3,'OPT').faults,7);
  assert.equal(run(examples.anomaly,3,'LRU').faults,10);
});
test('FIFO keeps load order while LRU responds to a hit', () => {
  assert.equal(run('1 2 1 3',2,'FIFO').steps[3].evicted.page,1);
  assert.equal(run('1 2 1 3',2,'LRU').steps[3].evicted.page,2);
});
test('Clock clears reference bits on a full sweep and advances only on placement', () => {
  const {steps} = run('1 2 3 1 4 2 5',3,'CLOCK');
  assert.equal(steps[3].hand,0);
  assert.deepEqual(steps[4].scanned,[0,1,2]);
  assert.equal(steps[4].evicted.page,1);
  assert.equal(steps[4].hand,1);
  assert.deepEqual(steps[6].scanned,[1]);
  assert.equal(steps[6].evicted.page,3);
  assert.equal(steps[0].frames[0].referenced,true);
});
test('dirty bits survive reads and each dirty eviction writes once', () => {
  for (const policy of POLICIES) {
    const r = run('1 1w 1r 2 1 3w',1,policy);
    assert.equal(r.writebacks,1);
    assert.equal(r.dirtyResident,1);
    assert.equal(r.steps[2].frames[0].dirty,true);
    assert.equal(r.steps[4].frames[0].dirty,false);
    assert.equal(r.hits,2);
  }
});
test('OPT uses future accesses and breaks infinity ties by frame index', () => {
  const r = run('1 2 3 1 2 4',2,'OPT');
  assert.equal(r.steps[2].evicted.page,2);
  assert.equal(r.steps[4].evicted.page,1);
});
test('invalid configurations reject early and inputs remain unchanged', () => {
  const trace = parseTrace('1 2 3'); const original = structuredClone(trace);
  for (const n of [0,17,1.5,NaN]) assert.throws(() => simulate(trace,n,'FIFO'));
  assert.throws(() => simulate(trace,2,'constructor'));
  assert.throws(() => simulate([{page:1,write:1}],2,'FIFO'));
  assert.throws(() => capacitySweep(trace,17));
  simulate(trace,2,'CLOCK'); assert.deepEqual(trace,original);
});
test('capacity sweeps include all policies and captured totals agree', () => {
  const report = analyze(examples.anomaly,3);
  assert.equal(report.sweep[2].results.FIFO,9);
  assert.equal(report.sweep[3].results.FIFO,10);
  for (const policy of POLICIES) {
    const r = report.results[policy];
    assert.equal(r.hits+r.faults,12);
    assert.deepEqual(r.steps.at(-1).totals,{hits:r.hits,faults:r.faults,writebacks:r.writebacks});
  }
});

// Independent exhaustive replacement oracle: enumerate every legal victim.
function oracle(pages,capacity,index=0,resident=[],memo=new Map()) {
  if (index===pages.length) return 0;
  const key=index+':'+[...resident].sort((a,b)=>a-b).join(',');
  if(memo.has(key))return memo.get(key);
  const page=pages[index]; let answer;
  if(resident.includes(page))answer=oracle(pages,capacity,index+1,resident,memo);
  else if(resident.length<capacity)answer=1+oracle(pages,capacity,index+1,[...resident,page],memo);
  else answer=1+Math.min(...resident.map((_,i)=>oracle(pages,capacity,index+1,resident.map((p,k)=>k===i?page:p),memo)));
  memo.set(key,answer);return answer;
}
test('OPT matches an exhaustive independent oracle on every 6-access ternary trace', () => {
  for(let code=0;code<729;code++){
    let n=code; const pages=Array.from({length:6},()=>{const p=n%3;n=Math.floor(n/3);return p;});
    const trace=pages.map(page=>({page,write:false}));
    for(const capacity of [1,2,3])assert.equal(simulate(trace,capacity,'OPT',{capture:false}).faults,oracle(pages,capacity));
  }
});
test('generated workloads preserve invariants and LRU/OPT stack monotonicity', () => {
  let seed=19; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let sample=0;sample<40;sample++){
    const trace=Array.from({length:40},()=>({page:random()%9,write:random()%3===0}));
    const sweep=capacitySweep(trace,10);
    for(let i=1;i<sweep.length;i++)for(const p of ['LRU','OPT'])assert.ok(sweep[i].results[p]<=sweep[i-1].results[p]);
    for(const p of POLICIES){const r=simulate(trace,4,p);assert.ok(r.faults>=sweep[3].results.OPT);
      for(const step of r.steps){const resident=step.frames.filter(Boolean);assert.equal(new Set(resident.map(f=>f.page)).size,resident.length);assert.ok(resident.some(f=>f.page===step.access.page));}
    }
  }
});
