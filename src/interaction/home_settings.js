import Api from './settings/api'
import Home from '../core/home/config.mjs'
import Storage from '../core/storage/storage'
import Settings from './settings/settings'
import Noty from './noty'

function init(){
    let rows = []
    const redraw = ()=>rows.forEach(row=>{if(row) row.description.text(row.read())})
    Home.subscribe(redraw)
    Settings.listener.follow('close',()=>{rows=[]})
    Settings.listener.follow('open',event=>{if(event.name !== 'home') rows=[]})
    Api.addComponent({component:'home',name:'Lampa Home',icon:'<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 3 2 12h3v9h6v-6h2v6h6v-9h3z"/></svg>'})
    const fields = [
        ['Устройство',()=>Home.status().deviceId],
        ['Сервер конфигурации',()=>Home.status().origin],
        ['Состояние',()=>({online:'Настройки получены с Pi',offline:'Сервер недоступен: сохранённые или локальные настройки',local:'Локальные настройки'})[Home.status().state]],
        ['TMDB Proxy',()=>Home.metadata() || 'Локальные настройки'],
        ['Jackett',()=>Storage.field('jackett_url') || 'Не настроен / выключен'],
        ['TorrServer',()=>Storage.get('torrserver_url') || 'Не настроен / выключен'],
        ['Не применяются',()=>((Home.status().unsupported || []).map(key=>({
            'ui.theme':'Тема интерфейса',
            'ui.density':'Плотность интерфейса',
            'metadata.credentialRef':'Ключ TMDB: proxy подставляет свой ключ'
        })[key]).join(', ') || 'Нет')],
        ['Управление',()=> 'Поля, назначенные на Pi, изменяются через веб-админку.']
    ]
    fields.forEach((field,index)=>Api.addParam({
        component:'home',param:{name:'home_status_'+index,type:'static'},field:{name:field[0]},
        onRender:item=>{
            const description = $('<div class="settings-param__descr"></div>').text(field[1]())
            rows[index] = {description,read:field[1]}
            item.append(description)
        }
    }))
    let refreshing = false, refreshRow
    Api.addParam({component:'home',param:{name:'home_refresh',type:'button'},field:{name:'Получить настройки с Pi'},
        onRender:item=>{refreshRow=item},
        onChange:()=>{
            if(refreshing) return
            refreshing = true
            if(refreshRow) refreshRow.attr('aria-disabled','true')
            Noty.show('Получение настроек с Pi…')
            Home.refresh().then(result=>{
                Noty.show(result.outcome === 'applied' ? 'Настройки с Pi применены' : result.outcome === 'unchanged' ? 'Настройки с Pi не изменились' : 'Не удалось получить настройки с Pi')
            }).catch(()=>Noty.show('Не удалось получить настройки с Pi')).then(()=>{
                refreshing = false
                if(refreshRow) refreshRow.removeAttr('aria-disabled')
            })
        }})
}
export default {init}
