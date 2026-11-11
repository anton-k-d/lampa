import Background from '../interaction/background'
import Utils from '../utils/utils'
import Category from '../interaction/items/category'
import CategoryModule from '../interaction/items/category/module/module'
import Router from '../core/router'
import Activity from '../interaction/activity/activity'
import {getSimilar,requestSimilar,waitSimilar,typedSeed,failureDetails,selectionText} from '../core/home/recommendations/client.mjs'

function component(object){
    let comp=Utils.createInstance(Category,object,{module:CategoryModule.toggle(CategoryModule.MASK.base,'Explorer','Loading','Next','Empty'),items:{cols:5}})
    comp.use({
        onCreate: function(){
            this.aiAlive=true
            this.aiStatus=$('<div class="ai-recommendation-status"></div>').text('Загрузка ИИ-подборки…')
            this.scroll.append(this.aiStatus)
            const seed=typedSeed(object.card)
            if(!seed) return this.aiMessage('Для этого источника подборка недоступна')
            const alive=()=>this.aiAlive && Activity.active()===object
            let pendingJob=null, generating=false
            const addRecovery=()=>{const button=$('<div class="full-start__button selector"></div>').text('Создать заново · новый платный запрос');button.on('hover:enter',generate);this.aiStatus.append(button)}
            const showFailure=(failure,jobId,selection,canGenerate)=>{
                const f=failureDetails(failure)
                const detail=f.message+' · '+f.action+(f.code?' · '+f.code:'')+(jobId?' · '+jobId:'')+(selection?' · '+selection:'')
                this.aiMessage(detail,f.retryable?generate:()=>show(false),f.retryable?'Повторить':'Проверить снова')
                if(!f.retryable && canGenerate===true && !pendingJob) addRecovery()
            }
            const render=(data)=>{
                const items=data.items || []
                const count=selectionText(data)
                if(!items.length){
                    if(data.state==='not_configured' || data.state==='needs_history' || data.state==='no_likes') return showFailure({code:data.state.toUpperCase()},data.jobId,count)
                    if(data.lastError || data.state==='failed') return showFailure(data.lastError || data,data.jobId,count,data.canGenerate)
                    return this.aiMessage('Подборка пока пуста'+(count?' · '+count:''),generate)
                }
                this.aiStatus.empty()
                if(count) this.aiStatus.append($('<div></div>').text(count))
                if(data.lastError){const f=failureDetails(data.lastError);this.aiStatus.append($('<div></div>').text(f.message+' · '+f.action+(f.code?' · '+f.code:'')))}
                if(data.lastError && !failureDetails(data.lastError).retryable){const check=$('<div class="full-start__button selector"></div>').text('Проверить снова');check.on('hover:enter',()=>show(false));this.aiStatus.append(check);if(data.canGenerate===true && !pendingJob) addRecovery()}
                const canRefresh=(data.stale || data.lastError) && (!data.lastError || failureDetails(data.lastError).retryable) && data.canGenerate===true && !pendingJob
                if(canRefresh){const button=$('<div class="full-start__button selector"></div>').text('Обновить подборку · новый платный запрос');button.on('hover:enter',generate);this.aiStatus.append(button)}
                else if((data.stale || (data.lastError && failureDetails(data.lastError).retryable)) && !pendingJob){const check=$('<div class="full-start__button selector"></div>').text('Проверить снова');check.on('hover:enter',()=>show(false));this.aiStatus.append(check)}
                if(!count && !data.lastError && !data.stale) this.aiStatus.remove()
                if(this.items && this.items.length){this.items.forEach(item=>item.destroy());this.items=[];this.pages={};this.loaded=[];this.added=0;this.active=0}
                this.aiItems=items.slice(0,10)
                this.build({results:this.aiItems.map(item=>item.card),page:1,total_pages:1})
            }
            const generate=async()=>{
                if(generating || pendingJob) return
                generating=true
                this.aiStatus.text('Создание подборки…')
                try{const data=await requestSimilar(seed,state=>{if(alive()) this.aiStatus.text(state==='queued'?'Подборка в очереди…':'Создание подборки…')},alive);if(alive()) render(data)}
                catch(e){if(alive()){pendingJob=(e.code==='TIMEOUT' || e.code==='UNAVAILABLE')?e.jobId || null:null;showFailure(e,e.jobId)}} finally {generating=false}
            }
            const show=async(allowCreate=true)=>{
                this.aiStatus.text('Загрузка ИИ-подборки…')
                try{
                    let data=await getSimilar(seed)
                    if(!alive()) return
                    if(['ready','failed','empty','not_configured','needs_history','no_likes','disabled'].includes(data.state)) pendingJob=null
                    if((data.state==='queued' || data.state==='running') && data.jobId){
                        pendingJob=data.jobId
                        this.aiStatus.text('Подборка в очереди…')
                        data=await waitSimilar(seed,data.jobId,alive)
                        pendingJob=null
                    }
                    else if((data.state==='empty' || (data.stale && !(data.items || []).length)) && !data.lastError && !pendingJob && allowCreate) return generate()
                    if(alive()) render(data)
                } catch(e){if(alive()){pendingJob=(e.code==='TIMEOUT' || e.code==='UNAVAILABLE')?(e.jobId || pendingJob):null;showFailure(e,e.jobId)}}
            }
            show()
        },
        onAiMessage: function(message,retry){},
        onInstance: function(item,data){
            item.use({onEnter:Router.call.bind(Router,'full',data),onFocus:function(){Background.change(Utils.cardImgBackground(data))}})
        },
        onAppend: function(item){
            let recommendation=this.aiItems && this.aiItems[this.added-1]
            if(!recommendation) return
            const target=$(item.render(true))
            if(recommendation.reason) target.append($('<div class="ai-recommendation-reason"></div>').text(recommendation.reason))
            const status=recommendation.citationStatus==='unverified'?'Источники не подтверждены':recommendation.citationStatus==='partial'?'Часть ссылок не подтверждена':''
            if(status) target.append($('<div class="ai-recommendation-reason ai-recommendation-source-status"></div>').text(status))
        },
        onDestroy: function(){this.aiAlive=false}
    })
    comp.aiMessage=function(message,retry,label){
        if(this.loading) this.loading.remove()
        this.aiStatus.empty().append($('<div></div>').text(message))
        if(retry){const button=$('<div class="full-start__button selector"></div>').text(label || 'Повторить'); button.on('hover:enter',retry);this.aiStatus.append(button)}
        if(retry) this.last=this.aiStatus.find('.selector')[0]
        this.activity.loader(false);this.activity.toggle()
    }
    return comp
}
export default component
