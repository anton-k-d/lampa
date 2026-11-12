import Premiere from './premiere'
import Extend from './extend'
import Preroll from './preroll'
import Banner from './banner'
import Platform from '../../core/platform'

function init(){
    if(window.lampa_settings.disable_features.ads) return

    Premiere.init()
    Extend.init()
    
    if(!Platform.is(['orsay', 'netcast'])){
        Preroll.init()
        Banner.init()
    }
}

export default {
    init
}
