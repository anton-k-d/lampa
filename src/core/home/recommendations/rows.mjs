import {capabilities,capabilitiesReady,getHome,refreshHome,syncStatus,failureDetails,selectionText} from './client.mjs';
export function registerRecommendationRow(ContentRows){
    ContentRows.add({name:'home_ai',title:'Для тебя',screen:['main'],index:1,call(){
        return [function(done){
            let settled=false;
            const finish=value=>{if(!settled){settled=true;clearTimeout(timer);done(value)}};
            const timer=setTimeout(()=>finish({results:[],title:'Для тебя',page:1,total_pages:1}),2500);
            capabilitiesReady().then(value=>value.enabled?getHome():Promise.reject(Error('disabled'))).then(data=>{
                let items=(data.items||[]).slice(0,10);
                const title=value=>'Для тебя'+(value.stale?' · сохранено':'')+(value.generatedAt?' · '+new Date(value.generatedAt).toLocaleString():'')+(selectionText(value)?' · '+selectionText(value):'');
                finish({results:items.map(item=>item.card),title:title(data),page:1,total_pages:1,params:{emit:{
                    onCreate(){
                        const button=$('<div class="items-line__more selector ai-home-refresh"></div>').text('Обновить');
                        const warning=$('<div class="ai-recommendation-status"></div>');
                        const recovery=$('<div class="items-line__more selector ai-home-recovery"></div>').text('Создать заново · новый платный запрос').hide();
                        const showWarning=(error,jobId)=>{const f=failureDetails(error); warning.text(f.message+' · '+f.action+(f.code?' · '+f.code:'')+(jobId?' · '+jobId:''));};
                        if(['not_configured','needs_history','no_likes'].includes(data.state)) showWarning({code:data.state.toUpperCase()});
                        else if(data.lastError) showWarning(data.lastError,data.jobId);
                        this.scroll.append(warning[0]);
                        let pendingJob=null, readOnly=!!(data.lastError && !failureDetails(data.lastError).retryable) || ['not_configured','needs_history','no_likes'].includes(data.state);
                        const updateRecovery=value=>{if(value.canGenerate===true && value.lastError && !failureDetails(value.lastError).retryable && !pendingJob && !['not_configured','needs_history','no_likes','queued','running'].includes(value.state)) recovery.show();else recovery.hide()};
                        updateRecovery(data);
                        recovery.on('hover:focus hover:touch',()=>{this.last=recovery[0]});
                        recovery.on('hover:enter',()=>{recovery.hide();readOnly=false;button.trigger('hover:enter')});
                        if(readOnly) button.text('Проверить снова');
                        button.on('hover:focus hover:touch',()=>{this.last=button[0]});
                        button.on('hover:enter',()=>{
                            button.text('Обновление…'); recovery.hide();
                            (pendingJob || readOnly?getHome():refreshHome()).then(data=>{
                                if(pendingJob && (data.state==='queued' || data.state==='running')){button.text('Проверить снова');return}
                                pendingJob=null; readOnly=!!(data.lastError && !failureDetails(data.lastError).retryable);
                                if(data.lastError) showWarning(data.lastError,data.jobId); else warning.empty();
                                updateRecovery(data);
                                if(data.state==='no_likes' || data.state==='needs_history' || data.state==='not_configured'){readOnly=true;showWarning({code:data.state.toUpperCase()});button.text('Проверить снова');return}
                                items=(data.items||[]).slice(0,10);
                                this.items.forEach(item=>item.destroy());
                                this.items=[]; this.active=0;
                                this.data.results=items.map(item=>item.card);
                                this.data.results.slice(0,this.view).forEach(this.emit.bind(this,'createAndAppend'));
                                this.html.find('.items-line__title').text(title(data));
                                button.text(readOnly?'Проверить снова':'Готово');
                            },e=>{pendingJob=e.jobId && (e.code==='TIMEOUT' || e.code==='UNAVAILABLE')?e.jobId:null;showWarning(e,e.jobId);readOnly=!failureDetails(e).retryable;button.text(pendingJob || readOnly?'Проверить снова':'Повторить');});
                        });
                        this.scroll.append(button[0]);
                        this.scroll.append(recovery[0]);
                    },
                    onAppend(card,element){const match=items.find(item=>item.card===element); if(!match) return; const target=$(card.render(true)); if(match.reason) target.append($('<div class="ai-recommendation-reason"></div>').text(match.reason)); const status=match.citationStatus==='unverified'?'Источники не подтверждены':match.citationStatus==='partial'?'Часть ссылок не подтверждена':''; if(status) target.append($('<div class="ai-recommendation-reason ai-recommendation-source-status"></div>').text(status));},
                    onlyMore:()=>{}
                }}});
            },()=>finish({results:[],title:'Для тебя',page:1,total_pages:1}));
        }];
    }});
}

export function registerRecommendationSettings(Settings){
    Settings.addComponent({component:'ai_home',name:'ИИ-подборки',icon:'<svg><use xlink:href="#sprite-reaction"></use></svg>'});
    Settings.addParam({component:'ai_home',param:{name:'ai_home_status',type:'static'},field:{name:'Состояние синхронизации'},onRender(item){
        const status=syncStatus();
        item.append($('<div class="settings-param__descr"></div>').text(status.state+' · пропущено: '+status.skipped));
    }});
    Settings.addParam({component:'ai_home',param:{name:'ai_home_refresh',type:'button'},field:{name:'Обновить подборку «Для тебя»'},onChange(){
        if(!capabilities().enabled){if(Lampa.Noty)Lampa.Noty.show('ИИ-подборки отключены');return}
        refreshHome().catch(()=>{});
    }});
}
