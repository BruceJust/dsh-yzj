import { chromium } from 'playwright'
const B='http://127.0.0.1:3090'
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1560,height:940}})
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
await p.goto(B,{waitUntil:'networkidle'}); await p.waitForTimeout(1800)
const s=p.locator('button',{hasText:'hi'}).first(); if(await s.count()>0){await s.click();await p.waitForTimeout(2200)}
await p.screenshot({path:'.acceptance/m0/three-column.png'})
console.log('--- three columns ---'); console.log((await p.evaluate(()=>document.body.innerText)).slice(0,1000))
const board=p.locator('button',{hasText:'承诺板'}).first()
if(await board.count()>0){await board.click();await p.waitForTimeout(1800);
  console.log('--- board ---'); console.log((await p.evaluate(()=>document.body.innerText)).slice(0,700))
  await p.screenshot({path:'.acceptance/m0/board.png'})}
console.log('--- errors ---'); console.log(errs.slice(0,8).join('\n')||'  (none)')
await b.close()
