import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
const now = Date.now(); const H = 3600e3;
const st = E.newState(100);
E.upsertTeam(st,'nfl',{id:'1',abbr:'CLE',name:'CLE',w:2,l:2,gp:4,diff:0,streak:1});
E.upsertTeam(st,'nfl',{id:'2',abbr:'PIT',name:'PIT',w:2,l:2,gp:4,diff:0,streak:1});
for (let i=0;i<60;i++) E.seedPlayer(st,'nfl',{id:'d'+i,name:'D '+i,pos:'CB',teamId:'1',teamAbbr:'CLE',gp:4,gs:2+ (i%10)*0.7,line:{}});
E.initForm(st,'nfl',{all:true}); E.repriceLeague(st,'nfl',now-5*H); st.lastTick=now-5*H;
const mu0 = st.stats.nfl.DEF.mu;
const line = (o)=>({passYds:0,passTD:0,int:0,cmp:0,att:0,rushYds:0,rushTD:0,car:0,rec:0,recYds:0,recTD:0,fumLost:0,tkl:0,sacks:0,defInt:0,pd:0,defTD:0,fg:0,xp:0,...o});
const g = (period, l)=>({id:'g1',date:now-4*H,name:'PIT @ CLE',detail:'',period,regPeriods:4,teams:[{id:'1',abbr:'CLE',score:7,home:true,winner:true},{id:'2',abbr:'PIT',score:3}],
  players:[{id:'new',name:'New Guy',pos:'CB',teamId:'1',teamAbbr:'CLE',line:line(l)},{id:'d3',name:'D 3',pos:'CB',teamId:'1',teamAbbr:'CLE',line:line({tkl:9,defInt:2,defTD:2,pd:3})}]});
E.applyLiveGame(st,'nfl',g(1,{tkl:0,pd:0,rushYds:1}),{now:now-3*H});
const a = st.assets['nfl:p:new']; const live = a.price;
const d3 = st.assets['nfl:p:d3']; const d3b = E.priceAt(d3, now-5*H);
E.applyFinalGame(st,'nfl',g(4,{tkl:3,pd:1}),{now});
E.repriceLeague(st,'nfl',now);
console.log('newcomer live', live, 'final', a.price, 'star game', d3b, '->', d3.price, 'mu', mu0, st.stats.nfl.DEF.mu, 'fame', a.fame);
assert.ok(Math.abs(a.price/live-1) < 0.3);
assert.ok(d3.price/d3b < 1.4);
assert.equal(st.stats.nfl.DEF.mu, mu0);
// repair of an old save
a.perf.ema = st.stats.nfl.DEF.mu; st.fixV = 0; E.repriceLeague(st,'nfl',now); st.holdings[a.id]={qty:2,cost:10,since:0}; const v=2*a.price;
assert.equal(E.repairNewcomers(st, now+1000), 1);
console.log('repaired', a.price, 'value', v, st.holdings[a.id].qty*a.price, a.hist);
assert.ok(Math.abs(st.holdings[a.id].qty*a.price - v) < 0.05);
console.log('ok');
