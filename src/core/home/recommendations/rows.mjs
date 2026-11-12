import More from '../../../interaction/more.js';
import Controller from '../../controller.js';
import {capabilities,capabilitiesReady,getHome,refreshHome,syncStatus,failureDetails,selectionText} from './client.mjs';
const HOME_LIMIT=30;
const ROW_TITLE='ИИ подборка';
function formatDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return '';
    const pad=n=>String(n).padStart(2,'0');
    return pad(date.getDate())+'.'+pad(date.getMonth()+1)+'.'+date.getFullYear()+' '+pad(date.getHours())+':'+pad(date.getMinutes());
}
function sampleCard(line){
    return line.items.find(item=>item&&item.html&&!item.html.classList.contains('card-more'));
}
function setLabel(tile,text){
    tile.html.find('.card-more__title').text(text);
}
function focusTile(line,tile){
    const node=tile.render(true);
    line.last=node;
    const index=line.items.indexOf(tile);
    line.active=index>=0?index:Math.max(0,line.items.length-1);
    line.scroll.update(node,line.params.items.align_left?false:true);
}
function place(line,tile){
    if(line.items.indexOf(tile)!==-1) return;
    const card=sampleCard(line);
    if(card) tile.size(card.render(true));
    line.scroll.append(tile.render(true));
    line.items.push(tile);
}
function detach(line,tile){
    const index=line.items.indexOf(tile);
    if(index>=0) line.items.splice(index,1);
    const node=tile.render(true);
    if(node.parentNode) node.parentNode.removeChild(node);
    if(line.last===node) line.last=false;
}
function syncLine(line,target){
    if(!Controller.own(line)) return;
    Controller.collectionSet(line.scroll.render(true));
    if(target) Controller.collectionFocus(target,line.scroll.render(true));
}
function makeTile(className,label){
    const tile=new More({text:label});
    tile.create();
    tile.html.classList.add(className);
    return tile;
}
export function registerRecommendationRow(ContentRows){
    ContentRows.add({name:'home_ai',title:ROW_TITLE,screen:['main'],index:0,call(){
        const load=function(done){
            let settled=false;
            const finish=value=>{if(!settled){settled=true;clearTimeout(timer);done(value)}};
            const timer=setTimeout(()=>finish({results:[],title:ROW_TITLE,page:1,total_pages:1}),2500);
            capabilitiesReady().then(value=>value.enabled?getHome():Promise.reject(Error('disabled'))).then(data=>{
                let items=(data.items||[]).slice(0,HOME_LIMIT);
                finish({results:items.map(item=>item.card),title:ROW_TITLE,page:1,total_pages:1,params:{items:{view:HOME_LIMIT},emit:{
                    onCreate(){
                        const line=this;
                        const head=line.html.find('.items-line__head');
                        const heading=document.createElement('div');
                        heading.className='ai-home-heading';
                        heading.append(head.find('.items-line__title'));
                        const date=document.createElement('div');
                        date.className='items-line__more ai-home-date';
                        heading.append(date);
                        const warning=document.createElement('div');
                        warning.className='ai-recommendation-status';
                        head.append(heading);
                        head.append(warning);
                        const paint=value=>{
                            const label=value.generatedAt?formatDate(value.generatedAt):'';
                            date.textContent=label;
                            date.classList.toggle('hide',!label);
                            const parts=[];
                            const count=selectionText(value);
                            if(count) parts.push(count);
                            let failure=null,jobId='';
                            if(['not_configured','needs_history','no_likes'].includes(value.state)) failure={code:value.state.toUpperCase()};
                            else if(value.lastError){failure=value.lastError;jobId=value.jobId||'';}
                            if(failure){const f=failureDetails(failure);parts.push(f.message+' · '+f.action+(f.code?' · '+f.code:'')+(jobId?' · '+jobId:''));}
                            warning.textContent=parts.join(' · ');
                            warning.classList.toggle('hide',!parts.length);
                        };
                        let pendingJob=null;
                        let readOnly=!!(data.lastError && !failureDetails(data.lastError).retryable) || ['not_configured','needs_history','no_likes'].includes(data.state);
                        let refresh,recovery;
                        const showRecovery=()=>{
                            if(!recovery || line.items.indexOf(recovery)!==-1) return;
                            place(line,recovery);
                            if(Controller.own(line)) Controller.collectionAppend(recovery.render(true));
                        };
                        const hideRecovery=()=>{
                            if(!recovery || line.items.indexOf(recovery)===-1) return;
                            const node=recovery.render(true);
                            detach(line,recovery);
                            if(typeof Navigator!=='undefined') Navigator.remove(node);
                        };
                        const updateRecovery=value=>{
                            if(value.canGenerate===true && value.lastError && !failureDetails(value.lastError).retryable && !pendingJob && !['not_configured','needs_history','no_likes','queued','running'].includes(value.state)) showRecovery();
                            else hideRecovery();
                        };
                        const mountTiles=()=>{
                            refresh=makeTile('ai-home-refresh',readOnly?'Проверить снова':'Обновить');
                            $(refresh.render(true)).on('hover:focus hover:touch',()=>focusTile(line,refresh));
                            $(refresh.render(true)).on('hover:enter',()=>{
                                setLabel(refresh,'Обновление…');
                                hideRecovery();
                                (pendingJob || readOnly?getHome():refreshHome()).then(next=>{
                                    if(pendingJob && (next.state==='queued' || next.state==='running')){setLabel(refresh,'Проверить снова');return}
                                    pendingJob=null;
                                    readOnly=!!(next.lastError && !failureDetails(next.lastError).retryable);
                                    paint(next);
                                    if(next.state==='no_likes' || next.state==='needs_history' || next.state==='not_configured'){readOnly=true;updateRecovery(next);setLabel(refresh,'Проверить снова');return}
                                    items=(next.items||[]).slice(0,HOME_LIMIT);
                                    line.items.forEach(item=>item.destroy());
                                    line.items=[];
                                    line.active=0;
                                    line.last=false;
                                    line.data.results=items.map(item=>item.card);
                                    line.data.results.slice(0,line.view).forEach(line.emit.bind(line,'createAndAppend'));
                                    mountTiles();
                                    updateRecovery(next);
                                    setLabel(refresh,readOnly?'Проверить снова':'Готово');
                                    line.last=refresh.render(true);
                                    syncLine(line,line.last);
                                },e=>{
                                    pendingJob=e.jobId && (e.code==='TIMEOUT' || e.code==='UNAVAILABLE')?e.jobId:null;
                                    paint({lastError:e,jobId:e.jobId});
                                    readOnly=!failureDetails(e).retryable;
                                    setLabel(refresh,pendingJob || readOnly?'Проверить снова':'Повторить');
                                });
                            });
                            recovery=makeTile('ai-home-recovery','Создать заново · новый платный запрос');
                            $(recovery.render(true)).on('hover:focus hover:touch',()=>focusTile(line,recovery));
                            $(recovery.render(true)).on('hover:enter',()=>{
                                detach(line,recovery);
                                readOnly=false;
                                $(refresh.render(true)).trigger('hover:enter');
                            });
                            place(line,refresh);
                        };
                        paint(data);
                        mountTiles();
                        updateRecovery(data);
                    },
                    onVisible(){
                        const card=sampleCard(this);
                        if(!card) return;
                        this.items.forEach(item=>{if(item&&item.html&&item.html.classList.contains('card-more')) item.size(card.render(true));});
                    }
                }}});
            },()=>finish({results:[],title:ROW_TITLE,page:1,total_pages:1}));
        };
        load.contentRow='home_ai';
        return [load];
    }});
}

export function registerRecommendationSettings(Settings){
    Settings.addComponent({component:'ai_home',name:'ИИ-подборки',icon:'<svg><use xlink:href="#sprite-reaction"></use></svg>'});
    Settings.addParam({component:'ai_home',param:{name:'ai_home_status',type:'static'},field:{name:'Состояние синхронизации'},onRender(item){
        const status=syncStatus();
        item.append($('<div class="settings-param__descr"></div>').text(status.state+' · пропущено: '+status.skipped));
    }});
    Settings.addParam({component:'ai_home',param:{name:'ai_home_refresh',type:'button'},field:{name:'Обновить подборку «ИИ подборка»'},onChange(){
        if(!capabilities().enabled){if(Lampa.Noty)Lampa.Noty.show('ИИ-подборки отключены');return}
        refreshHome().catch(()=>{});
    }});
}
