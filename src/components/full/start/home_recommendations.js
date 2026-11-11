import Activity from '../../../interaction/activity/activity'
import {capabilities,typedSeed} from '../../../core/home/recommendations/client.mjs'
export default {
    onCreate: function(){
        if(!capabilities().enabled || !typedSeed(this.card)) return
        const button=$('<div class="full-start__button selector button--home-ai"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/><path d="m5 3 .7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7L5 3Z"/></svg><span>ИИ-подборка</span></div>')
        button.on('hover:focus hover:hover hover:touch',()=>{this.last=button[0]})
        button.on('hover:enter',()=>Activity.push({url:'',title:'ИИ-подборка',component:'home_recommendations',card:this.card}))
        this.html.find('.button--options').before(button)
    }
}
