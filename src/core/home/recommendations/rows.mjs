import {capabilities,capabilitiesReady,getHome,refreshHome,syncStatus} from './client.mjs';
export function registerRecommendationRow(ContentRows){
    ContentRows.add({name:'home_ai',title:'Для тебя',screen:['main'],index:1,call(){
        return [function(done){
            let settled=false;
            const finish=value=>{if(!settled){settled=true;clearTimeout(timer);done(value)}};
            const timer=setTimeout(()=>finish({results:[],title:'Для тебя',page:1,total_pages:1}),2500);
            capabilitiesReady().then(value=>value.enabled?getHome():Promise.reject(Error('disabled'))).then(data=>{
                let items=(data.items||[]).slice(0,12);
                finish({results:items.map(item=>item.card),title:'Для тебя'+(data.stale?' · сохранено':'')+(data.generatedAt?' · '+new Date(data.generatedAt).toLocaleString():''),page:1,total_pages:1,params:{emit:{
                    onCreate(){
                        const button=$('<div class="items-line__more selector ai-home-refresh"></div>').text('Обновить');
                        button.on('hover:focus hover:touch',()=>{this.last=button[0]});
                        button.on('hover:enter',()=>{
                            button.text('Обновление…');
                            refreshHome().then(data=>{
                                if(data.state==='no_likes' || data.state==='needs_history' || data.state==='not_configured'){button.text('Обновить');return}
                                items=(data.items||[]).slice(0,12);
                                this.items.forEach(item=>item.destroy());
                                this.items=[]; this.active=0;
                                this.data.results=items.map(item=>item.card);
                                this.data.results.slice(0,this.view).forEach(this.emit.bind(this,'createAndAppend'));
                                this.html.find('.items-line__title').text('Для тебя'+(data.stale?' · сохранено':'')+(data.generatedAt?' · '+new Date(data.generatedAt).toLocaleString():''));
                                button.text('Готово');
                            },()=>button.text('Повторить'));
                        });
                        this.scroll.append(button[0]);
                    },
                    onAppend(card,element){const match=items.find(item=>item.card===element); if(!match) return; const target=$(card.render(true)); if(match.reason) target.append($('<div class="ai-recommendation-reason"></div>').text(match.reason)); const status=match.citationStatus==='unverified'?'Источники не подтверждены':match.citationStatus==='partial'?'Часть ссылок не подтверждена':''; if(status) target.append($('<div class="ai-recommendation-reason ai-recommendation-source-status"></div>').text(status));},
                    onlyMore:()=>refreshHome().catch(()=>{})
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
