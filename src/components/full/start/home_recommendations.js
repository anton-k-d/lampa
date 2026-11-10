import Activity from '../../../interaction/activity/activity'
import {capabilities,typedSeed} from '../../../core/home/recommendations/client.mjs'
export default {
    onCreate: function(){
        if(!capabilities().enabled || !typedSeed(this.card)) return
        const button=$('<div class="full-start__button selector button--home-ai"><span>ИИ-подборка</span></div>')
        button.on('hover:focus hover:hover hover:touch',()=>{this.last=button[0]})
        button.on('hover:enter',()=>Activity.push({url:'',title:'ИИ-подборка',component:'home_recommendations',card:this.card}))
        this.html.find('.button--options').before(button)
    }
}
