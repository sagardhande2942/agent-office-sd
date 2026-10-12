import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import { TuiFrame } from '../src/server/tui/frame.js';
import { TuiTerminal } from '../src/server/tui-terminal.js';

test('changed-row painting preserves other rows, clears shortened text and never scrolls the bottom row',async()=>{
  const term=new headless.Terminal({cols:8,rows:3,allowProposedApi:true}),frame=new TuiFrame();
  const write=(text:string)=>new Promise<void>(r=>term.write(text,r));
  try{
    await write('\x1b[?1049h'+frame.paint(['HEADER','LONGTEXT','12345678'],8,3));
    const patch=frame.paint(['HEADER','short','12345678'],8,3);
    assert.ok(!patch.includes('\x1b[2J'));assert.ok(!patch.includes('HEADER'));assert.ok(!patch.includes('12345678'));
    await write(patch);
    assert.equal(term.buffer.active.getLine(0)?.translateToString(true),'HEADER');
    assert.equal(term.buffer.active.getLine(1)?.translateToString(true),'short');
    assert.equal(term.buffer.active.getLine(2)?.translateToString(true),'12345678');
    assert.equal(term.buffer.active.baseY,0);
    assert.equal(frame.paint(['HEADER','short','12345678'],8,3),'');
    term.resize(10,4);await write(frame.paint(['RESIZED'],10,4));
    assert.equal(term.buffer.active.getLine(1)?.translateToString(true),'');
    frame.reset();assert.match(frame.paint(['BACK'],10,4),/\x1b\[2J/);
  }finally{term.dispose();}
});
test('attached output updates preserve colors and cursor without repeated full clears',async()=>{
  const host=new headless.Terminal({cols:20,rows:4,allowProposedApi:true});let output='';
  const pending:Promise<void>[]=[];
  const viewer=new TuiTerminal(20,4,data=>{output+=data;pending.push(new Promise(r=>host.write(data,r)));});
  const settle=async()=>{await Promise.all(pending);pending.length=0;};
  try{
    await viewer.write('\x1b[31mSTABLE\x1b[0m\r\nold value');await settle();output='';
    await viewer.write('\rnew\x1b[K');await settle();
    assert.ok(!output.includes('\x1b[2J'));assert.ok(!output.includes('STABLE'));
    assert.equal(host.buffer.active.getLine(0)?.translateToString(true),'STABLE');
    assert.equal(host.buffer.active.getLine(0)?.getCell(0)?.getFgColor(),1);
    assert.equal(host.buffer.active.getLine(1)?.translateToString(true),'new');
    assert.equal(host.buffer.active.cursorX,3);assert.equal(host.buffer.active.cursorY,1);
  }finally{viewer.dispose();host.dispose();}
});
