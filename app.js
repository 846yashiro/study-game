const $=id=>document.getElementById(id);
const defaults={points:0,exp:0,level:1,history:[],goalMinutes:30,timeCoeff:1,inkCoeff:1.5,streak:0,lastStudyDate:null};
const state=Object.assign({},defaults,JSON.parse(localStorage.getItem("studyQuest")||"null")||{});
let beforeData=null,afterData=null,startWall=0,elapsedBeforePause=0,isPaused=false,timerId=null;

function save(){localStorage.setItem("studyQuest",JSON.stringify(state))}
function todayKey(){const d=new Date();return d.toISOString().slice(0,10)}
function minutesToday(){const k=todayKey();return Math.round(state.history.filter(h=>h.dateKey===k).reduce((a,h)=>a+h.seconds,0)/60)}
function updateHome(){
 const mins=minutesToday(),goal=Math.max(1,Number(state.goalMinutes)||30);
 $("goalText").textContent=`${goal} 分`; $("todayText").textContent=`今日の勉強時間 ${mins} 分`;
 $("goalBar").style.width=`${Math.min(100,mins/goal*100)}%`;
 $("speechText").innerHTML=mins>=goal?"今日の目標達成！えらいね。":mins===0?"まずは少しだけ始めてみよう。":`あと ${Math.max(0,goal-mins)} 分で今日の目標だよ。`;
 $("mascot").textContent=["😺","🐱","😸","😺","😻","🐯"][Math.min(5,state.level-1)];
}
function updateHeader(){
 $("pointsText").textContent=`★ ${state.points} pt`; $("levelText").textContent=`Lv.${state.level}`;
 $("expText").textContent=`${state.exp} / 100 EXP`; $("expBar").style.width=`${state.exp}%`; updateHome();
}
function showScreen(id){document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));$(id).classList.add("active");scrollTo(0,0);if(id==="historyScreen")renderHistory();if(id==="achievementScreen")renderAchievements();if(id==="settingsScreen")loadSettings()}
function formatTime(sec){sec=Math.max(0,Math.floor(sec));return`${String(Math.floor(sec/3600)).padStart(2,"0")}:${String(Math.floor(sec%3600/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`}
function resetSession(){
 beforeData=afterData=null;startWall=0;elapsedBeforePause=0;isPaused=false;clearInterval(timerId);timerId=null;
 $("timer").textContent="00:00:00";$("timerState").textContent="待機中";
 $("beforeInput").value="";$("afterInput").value="";$("beforePreview").src="";$("afterPreview").src="";
 $("beforePreview").parentElement.classList.remove("has-image");$("afterPreview").parentElement.classList.remove("has-image");
 $("beginTimerBtn").disabled=true;$("finishBtn").classList.add("hidden");$("pauseBtn").classList.add("hidden");$("beginTimerBtn").classList.remove("hidden");
 $("analyzeBtn").disabled=true;$("beforeLabel").textContent="📷 勉強前の写真を選ぶ";$("afterLabel").textContent="📷 勉強後の写真を選ぶ";
}
function readImage(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})}
function loadImg(src){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src})}
async function makeGray(src){
 const im=await loadImg(src),w=640,h=480,c=document.createElement("canvas");c.width=w;c.height=h;const ctx=c.getContext("2d");
 ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);const sc=Math.min(w/im.width,h/im.height),dw=im.width*sc,dh=im.height*sc;
 ctx.drawImage(im,(w-dw)/2,(h-dh)/2,dw,dh);const d=ctx.getImageData(0,0,w,h).data,a=new Float32Array(w*h);
 for(let i=0,p=0;i<a.length;i++,p+=4)a[i]=.299*d[p]+.587*d[p+1]+.114*d[p+2];
 return{a,w,h}
}
function bestShift(pre,post){
 const step=4,max=12;let best={dx:0,dy:0,score:Infinity};
 for(let dy=-max;dy<=max;dy+=step)for(let dx=-max;dx<=max;dx+=step){
  let sum=0,n=0;
  for(let y=20;y<pre.h-20;y+=6){const py=y+dy;if(py<0||py>=pre.h)continue;
   for(let x=20;x<pre.w-20;x+=6){const px=x+dx;if(px<0||px>=pre.w)continue;
    const i=y*pre.w+x,j=py*post.w+px,aa=Math.max(0,180-pre.a[i]),bb=Math.max(0,180-post.a[j]),d=aa-bb;
    sum+=d*d;n++;
   }
  }
  const score=sum/(n||1);if(score<best.score)best={dx,dy,score};
 }
 return best
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function estimateInk(pre,post,s){
 const block=8;let added=0,paper=0;
 for(let y=10;y<pre.h-10;y+=block)for(let x=10;x<pre.w-10;x+=block){
  let pa=0,po=0,n=0;
  for(let yy=0;yy<block&&y+yy<pre.h;yy+=2)for(let xx=0;xx<block&&x+xx<pre.w;xx+=2){
   const i=(y+yy)*pre.w+x+xx,px=x+xx+s.dx,py=y+yy+s.dy;if(px<0||py<0||px>=post.w||py>=post.h)continue;
   const j=py*post.w+px;pa+=clamp((150-pre.a[i])/150,0,1);po+=clamp((150-post.a[j])/150,0,1);n++;
  }
  if(n){pa/=n;po/=n;added+=Math.max(0,po-pa-.04)*n;paper+=n}
 }
 return clamp(added/(paper||1)*100,0,100)
}
function quality(s){
 const d=Math.hypot(s.dx,s.dy);
 return d<=4?["良好","位置ずれは小さく、比較しやすい状態です。"]:d<=10?["普通","少し位置ずれがあります。できるだけ同じ位置から撮影してください。"]:["注意","位置ずれが大きめです。結果は参考値として扱ってください。"]
}
function calcElapsed(){return isPaused?elapsedBeforePause:elapsedBeforePause+Math.floor((Date.now()-startWall)/1000)}
function updateStreak(){
 const t=todayKey(),last=state.lastStudyDate;if(last===t)return;
 if(!last)state.streak=1;else{const d=Math.round((new Date(t)-new Date(last))/86400000);state.streak=d===1?state.streak+1:1}
 state.lastStudyDate=t;
}
function award(points,record){
 state.points+=points;state.exp+=points;while(state.exp>=100){state.exp-=100;state.level++}
 state.history.unshift(record);state.history=state.history.slice(0,100);updateStreak();save();updateHeader();
}
$("beforeInput").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;beforeData=await readImage(f);$("beforePreview").src=beforeData;$("beforePreview").parentElement.classList.add("has-image");$("beforeLabel").textContent="撮影済み";$("beginTimerBtn").disabled=false});
$("beginTimerBtn").addEventListener("click",()=>{startWall=Date.now();isPaused=false;$("beginTimerBtn").classList.add("hidden");$("pauseBtn").classList.remove("hidden");$("finishBtn").classList.remove("hidden");$("timerState").textContent="勉強中";timerId=setInterval(()=>$("timer").textContent=formatTime(calcElapsed()),250)});
$("pauseBtn").addEventListener("click",()=>{if(isPaused){startWall=Date.now();isPaused=false;$("pauseBtn").textContent="Ⅱ 一時停止";$("timerState").textContent="勉強中"}else{elapsedBeforePause=calcElapsed();isPaused=true;$("pauseBtn").textContent="▶ 再開";$("timerState").textContent="一時停止中"}});
$("finishBtn").addEventListener("click",()=>{elapsedBeforePause=calcElapsed();isPaused=true;clearInterval(timerId);timerId=null;$("timer").textContent=formatTime(elapsedBeforePause);$("sessionSummary").innerHTML=`<strong>${$("subject").value}</strong> / ${$("taskName").value.trim()||"課題名なし"}<br>勉強時間：${formatTime(elapsedBeforePause)}`;showScreen("afterScreen")});
$("afterInput").addEventListener("change",async e=>{const f=e.target.files[0];if(!f)return;afterData=await readImage(f);$("afterPreview").src=afterData;$("afterPreview").parentElement.classList.add("has-image");$("afterLabel").textContent="撮影済み";$("analyzeBtn").disabled=false});
$("analyzeBtn").addEventListener("click",async()=>{
 $("analyzeBtn").disabled=true;$("analyzeBtn").textContent="計算中…";
 try{
  const pre=await makeGray(beforeData),post=await makeGray(afterData),s=bestShift(pre,post),ink=estimateInk(pre,post,s),q=quality(s);
  const timePts=Math.round(elapsedBeforePause/60*Number(state.timeCoeff)),inkPts=Math.round(ink*Number(state.inkCoeff)),bonus=Math.min(20,state.streak*2),points=Math.max(1,timePts+inkPts+bonus);
  const subject=$("subject").value,task=$("taskName").value.trim()||"課題名なし",memo=$("studyMemo").value.trim();
  $("resultTask").textContent=`${subject} / ${task}`;$("resultTime").textContent=formatTime(elapsedBeforePause);$("resultInk").textContent=ink.toFixed(2)+" %";
  $("resultQuality").textContent=q[0];$("qualityNote").textContent=q[1];$("resultPoints").textContent=`+${points} pt`;
  $("resultBreakdown").textContent=`時間 ${timePts} pt ＋ 書き込み ${inkPts} pt ＋ 継続ボーナス ${bonus} pt`;
  award(points,{dateKey:todayKey(),date:new Date().toLocaleString("ja-JP"),seconds:elapsedBeforePause,ink,points,subject,task,memo,quality:q[0],shift:Math.hypot(s.dx,s.dy)});
  showScreen("resultScreen");
 }catch(e){alert("画像の計算に失敗しました。別の画像で試してください。");console.error(e)}
 finally{$("analyzeBtn").disabled=false;$("analyzeBtn").textContent="🔍 結果を計算する"}
});
function renderHistory(){
 const f=$("historySubjectFilter").value,hs=state.history.filter(h=>f==="すべて"||h.subject===f);
 const mins=Math.round(hs.reduce((a,h)=>a+h.seconds,0)/60),pts=hs.reduce((a,h)=>a+h.points,0);
 $("historySummary").innerHTML=`<strong>${f}の記録</strong><div class="row" style="margin-top:10px"><span>勉強 ${mins} 分</span><span>${pts} pt</span><span>${hs.length} 回</span></div>`;
 $("historyList").innerHTML=hs.length?hs.map(h=>`<div class="history-item"><div><strong>${h.date}</strong><small>${h.subject} / ${h.task}<br>${formatTime(h.seconds)} / 推定書き込み ${h.ink.toFixed(2)}% / 画像 ${h.quality||"-"}</small></div><div class="history-points">+${h.points} pt</div></div>`).join(""):'<div class="card">まだ学習記録がありません。</div>';
}
function renderAchievements(){
 const mins=Math.round(state.history.reduce((a,h)=>a+h.seconds,0)/60),n=state.history.length,p=state.points;
 const a=[["初回学習","初めて勉強記録を残す",n>=1],["30分突破","累計30分勉強する",mins>=30],["3時間突破","累計180分勉強する",mins>=180],["10回記録","10回以上記録する",n>=10],["500pt","累計500pt",p>=500],["3日継続","3日以上連続",state.streak>=3]];
 $("achievementList").innerHTML=a.map(x=>`<div class="achievement ${x[2]?"":"locked"}"><div class="achievement-title">${x[2]?"✅":"🔒"} ${x[0]}</div><div class="achievement-desc">${x[1]}</div></div>`).join("");
}
$("historySubjectFilter").addEventListener("change",renderHistory);
$("clearHistoryBtn").addEventListener("click",()=>{if(confirm("学習履歴をすべて削除しますか？")){state.history=[];state.streak=0;state.lastStudyDate=null;save();updateHeader();renderHistory()}});
$("exportBtn").addEventListener("click",()=>{
 if(!state.history.length){alert("出力できる記録がありません。");return}
 const head=["date","dateKey","subject","task","seconds","ink_percent","points","quality","shift","memo"];
 const rows=state.history.map(h=>[h.date,h.dateKey,h.subject,h.task,h.seconds,h.ink,h.points,h.quality,h.shift,h.memo].map(v=>`"${String(v??"").replaceAll('"','""')}"`));
 const csv=[head.join(","),...rows.map(r=>r.join(","))].join("\n");const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`StudyQuest_research_${todayKey()}.csv`;a.click();
});
function loadSettings(){$("goalInput").value=state.goalMinutes;$("timeCoeffInput").value=state.timeCoeff;$("inkCoeffInput").value=state.inkCoeff}
$("saveSettingsBtn").addEventListener("click",()=>{state.goalMinutes=Math.max(1,Number($("goalInput").value)||30);state.timeCoeff=Math.max(0,Number($("timeCoeffInput").value)||1);state.inkCoeff=Math.max(0,Number($("inkCoeffInput").value)||1.5);save();updateHeader();alert("設定を保存しました。");showScreen("homeScreen")});
$("startBtn").addEventListener("click",()=>{resetSession();showScreen("studyScreen")});$("studyNav").addEventListener("click",()=>{resetSession();showScreen("studyScreen")});
$("cancelBtn").addEventListener("click",()=>{resetSession();showScreen("homeScreen")});$("backToHomeBtn").addEventListener("click",()=>{resetSession();showScreen("homeScreen")});
$("resultHomeBtn").addEventListener("click",()=>{resetSession();showScreen("homeScreen")});$("historyBtn").addEventListener("click",()=>showScreen("historyScreen"));$("historyNav").addEventListener("click",()=>showScreen("historyScreen"));$("historyHomeBtn").addEventListener("click",()=>showScreen("homeScreen"));
$("achievementBtn").addEventListener("click",()=>showScreen("achievementScreen"));$("achievementHomeBtn").addEventListener("click",()=>showScreen("homeScreen"));
$("settingsBtn").addEventListener("click",()=>showScreen("settingsScreen"));$("settingsHomeBtn").addEventListener("click",()=>showScreen("homeScreen"));
document.querySelectorAll(".bottom-nav button[data-screen]").forEach(b=>b.addEventListener("click",()=>showScreen(b.dataset.screen)));
updateHeader();
