import Background from '../interaction/background'
import Utils from '../utils/utils'
import Category from '../interaction/items/category'
import CategoryModule from '../interaction/items/category/module/module'
import Router from '../core/router'
import Activity from '../interaction/activity/activity'
import {getSimilar,requestSimilar,waitSimilar,typedSeed} from '../core/home/recommendations/client.mjs'

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
            const show=async()=>{
                this.aiStatus.text('Загрузка ИИ-подборки…')
                try{
                    let data=await getSimilar(seed)
                    if(!alive()) return
                    if((data.state==='queued' || data.state==='running') && data.jobId){
                        this.aiStatus.text('Подборка в очереди…')
                        data=await waitSimilar(seed,data.jobId,alive)
                    }
                    else if(data.stale || data.state==='empty' || data.state==='needs_history') data=await requestSimilar(seed,state=>{if(alive()) this.aiStatus.text(state==='queued'?'Подборка в очереди…':'Создание подборки…')},alive)
                    if(!alive()) return
                    if(data.state==='not_configured') return this.aiMessage('Администратор должен настроить ключ OpenAI')
                    if(data.state==='needs_history') return this.aiMessage('Сначала синхронизируйте историю')
                    if(!data.items || !data.items.length) return this.aiMessage('Подборка пока пуста',show)
                    this.aiStatus.remove()
                    this.aiItems=data.items.slice(0,12)
                    this.build({results:data.items.slice(0,12).map(item=>item.card),page:1,total_pages:1})
                } catch(e){if(alive()) this.aiMessage('Не удалось получить подборку',show)}
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
    comp.aiMessage=function(message,retry){
        if(this.loading) this.loading.remove()
        this.aiStatus.empty().append($('<div></div>').text(message))
        if(retry){const button=$('<div class="full-start__button selector"></div>').text('Повторить'); button.on('hover:enter',retry);this.aiStatus.append(button)}
        if(retry) this.last=this.aiStatus.find('.selector')[0]
        this.activity.loader(false);this.activity.toggle()
    }
    return comp
}
export default component
