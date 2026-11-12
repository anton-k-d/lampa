import Color from '../utils/color'
import Storage from '../core/storage/storage'
import Arrays from '../utils/arrays'
import Platform from '../core/platform'
import Player from './player'
import Manifest from '../core/manifest'

let html = $(`
    <div class="background">
        <canvas class="background__one"></canvas>
        <canvas class="background__two"></canvas>
        <canvas class="background__fade"></canvas>
    </div>`)

let background = {
    one:{
        canvas: $('.background__one',html),
        ctx: $('.background__one',html)[0].getContext('2d')
    },
    two:{
        canvas: $('.background__two',html),
        ctx: $('.background__two',html)[0].getContext('2d')
    },
    fade:{
        canvas: $('.background__fade',html),
        ctx: $('.background__fade',html)[0].getContext('2d')
    }
}

let theme_elem = $('head meta[name="theme-color"]')

let view = 'one'
let src  = ''
let loaded = {}
let bokeh  = {
    c: [],
    h: [],
    d: true
}

let timer
let immed_time  = Date.now()
let theme_color = '#000000'
let timer_change
let loadGen = 0
let fadeRaf = 0
let pendingImg = null

function cancelFade(){
    if(fadeRaf){
        cancelAnimationFrame(fadeRaf)
        fadeRaf = 0
    }

    clearTimeout(timer_change)
}

function cancelPendingImage(){
    if(!pendingImg) return

    pendingImg.onload = null
    pendingImg.onerror = null
    pendingImg.src = ''
    pendingImg = null
}


/**
 * Запуск
 */
function init(){
    Storage.listener.follow('change', (event)=>{
        if(event.name == 'background' || event.name == 'background_type') resize()
    })

    let u = Platform.any() ? Manifest.github_lampa : './'
    if(Platform.is('orsay')){
        u = './'
    }
    for (let i = 1; i <= 6; i++) {
        let im = new Image()
            im.src = u + 'img/bokeh-h/'+i+'.png'

        bokeh.h.push(im)
    }

    for (let i = 1; i <= 6; i++) {
        let im = new Image()
            im.src = u + 'img/bokeh/'+i+'.png'

        bokeh.c.push(im)
    }

    background.one.canvas[0].width  = window.screen_width
    background.one.canvas[0].height = window.screen_height
    background.two.canvas[0].width  = window.screen_width
    background.two.canvas[0].height = window.screen_height
    background.fade.canvas[0].width  = window.screen_width
    background.fade.canvas[0].height = window.screen_height

    Lampa.Listener.follow('resize_start', ()=>{
        html[0].style.opacity  = 0
    })

    Lampa.Listener.follow('resize_end', ()=>{
        html[0].style.opacity  = 1

        resize()
    })

    html[0].toggleClass('hide', !Storage.field('background'))
}

/**
 * Получить активный фон
 * @returns {{canvas:object, ctx: class}}
 */
function bg(){
    view = view == 'one' ? 'two' : 'one';

    return background[view]
}

/**
 * Рисовать
 * @param {object} data 
 * @param {object} item - фон
 * @param {boolean} noimage
 */
function draw(data, item, noimage, gen){
    if(gen != null && gen !== loadGen) return

    if(noimage) return

    // Для мобильных устройств делаем полный сброс canvas
    if(Platform.screen('mobile')){
        item.canvas[0].width  = window.screen_width
        item.canvas[0].height = window.screen_height
    }
    else{
        item.ctx.clearRect(0, 0, window.screen_width, window.screen_height)
    }

    let palette = data.palette
    let type    = Storage.field('background_type')

    blur(data, item, ()=>{
        if(gen != null && gen !== loadGen) return

        if(type == 'complex' && bokeh.d){
            let bright = Color.rgbToHsl(palette.average[0],palette.average[1],palette.average[2]) 

            item.ctx.globalAlpha = bright[2] > 30 ? bright[2] / 100 * 0.6 : 0.4
            item.ctx.globalCompositeOperation = bright[2] > 30 ? 'color-dodge' : 'screen'
            
            for(let i = 0; i < 10; i++){
                let bp = Math.round(Math.random() * (bokeh.c.length - 1))
                let im = bright[2] > 30 ? bokeh.h[bp] : bokeh.c[bp]
                let xp = window.screen_width * Math.random(),
                    yp = (window.screen_height / 2) * Math.random() + (window.screen_height / 2),
                    sz = Math.max(window.screen_height / 8, window.screen_height / 5 * Math.random()) * 0.01,
                    nw = im.width * sz,
                    nh = im.height * sz
                
                try{
                    item.ctx.drawImage(im, xp - (nw / 2), yp - (nw / 2), nw, nh)
                }
                catch(e){}
            }
        }


        item.ctx.globalAlpha = type == 'poster' ? 0.7 : 0.6
        item.ctx.globalCompositeOperation = 'multiply'

        let angle = 90 * Math.PI / 180,
            x2 = window.screen_width * Math.cos(angle),
            y2 = window.screen_height * Math.sin(angle)

        let gradient = item.ctx.createLinearGradient(0, 0, x2, y2)
            gradient.addColorStop(0, 'rgba(0,0,0,1)')
            gradient.addColorStop(1, 'rgba(0,0,0,'+(type == 'poster' ? 0.4 : 0)+')')

        item.ctx.fillStyle = gradient

        item.ctx.fillRect(0, 0, window.screen_width, window.screen_height)

        if(Platform.screen('mobile')){
            item.ctx.globalAlpha = 1
            item.ctx.globalCompositeOperation = 'destination-out'

            gradient = item.ctx.createLinearGradient(0, 0, x2, y2)
            gradient.addColorStop(0.05, 'rgba(29,31,32,1)')
            gradient.addColorStop(0.18, 'rgba('+palette.bright.join(',')+',0)')

            item.ctx.fillStyle = gradient

            item.ctx.fillRect(0, 0, window.screen_width, window.screen_height)

            clearTimeout(timer_change)

            timer_change = setTimeout(()=>{
                html.find('canvas').eq(view == 'one' ? 1 : 0).removeClass('visible')
            },400)

            item.canvas.addClass('visible')
        }
        else{
            fadeTo(item, gen)
        }

        if(!Player.opened()) theme(Storage.field('black_style') ? 'black' : 'reset')
    }, gen)
}

/**
 * Плавный переход с двойным прогревом обоих canvas
 */
function fadeTo(new_bg, gen) {
    if(gen != null && gen !== loadGen) return

    cancelFade()

    const fade      = background.fade.ctx
    const old_image = background[view === 'one' ? 'two' : 'one'].canvas[0]
    const new_image = new_bg.canvas[0]
    const duration  = 700   // длительность fade
    const warmup    = 80    // прогрев GPU
    const start     = Date.now()

    function step() {
        if(gen != null && gen !== loadGen) return

        const elapsed = Date.now() - start

        if (elapsed < warmup) {
            // прогрев: оба слоя с альфой 0
            fade.globalAlpha = 0
            fade.drawImage(old_image, 0, 0)
            fade.drawImage(new_image, 0, 0)
            fadeRaf = requestAnimationFrame(step)
            return
        }

        // плавный переход
        const progress = Math.min((elapsed - warmup) / duration, 1)
        const eased = progress * progress * (3 - 2 * progress) // easeInOutCubic

        // сначала рисуем старый фон
        fade.globalAlpha = 1
        fade.drawImage(old_image, 0, 0)

        // поверх рисуем новый с альфой
        fade.globalAlpha = eased
        fade.drawImage(new_image, 0, 0)

        if (progress < 1) {
            fadeRaf = requestAnimationFrame(step)
        }
        else fadeRaf = 0
    }

    // небольшой defer для синхронизации с рендером браузера
    fadeRaf = requestAnimationFrame(() => {
        if(gen != null && gen !== loadGen) return

        fadeRaf = requestAnimationFrame(step)
    })
}


/**
 * Размыть картинку
 * @param {object} data 
 * @param {object} item - фон
 * @param {function} complite 
 */
function blur(data, item, complite, gen){
    function blured(img){
        if(gen != null && gen !== loadGen) return

        let ratio = Math.max(window.screen_width / img.width, window.screen_height / img.height)

		let nw = img.width * ratio,
			nh = img.height * ratio;

            item.ctx.globalAlpha = data.img.width > 1000 ? (bokeh.d ? 1 : 0.2) : 1

            item.ctx.drawImage(img, -(nw-window.screen_width) / 2, -(nh-window.screen_height) / 2, nw, nh)

            complite()
    }

    if(gen != null && gen !== loadGen) return

    if(data.img.width > 1000) blured(data.img)
    else Color.blur(data.img, blured)
}

/**
 * Обновить если изменился размер окна
 */
function resize(){
    background.one.canvas[0].width  = window.screen_width
    background.one.canvas[0].height = window.screen_height
    background.two.canvas[0].width  = window.screen_width
    background.two.canvas[0].height = window.screen_height
    background.fade.canvas[0].width  = window.screen_width
    background.fade.canvas[0].height = window.screen_height

    background.one.canvas.width(window.screen_width)
    background.one.canvas.height(window.screen_height)

    background.two.canvas.width(window.screen_width)
    background.two.canvas.height(window.screen_height)

    background.fade.canvas.width(window.screen_width)
    background.fade.canvas.height(window.screen_height)

    html[0].toggleClass('hide', !Storage.field('background'))

    if(loaded[src]) draw(loaded[src], background[view], false, loadGen)
}

/**
 * Максимум картинок в памяти
 */
function limit(){
    let a = Arrays.getKeys(loaded)

    if(a.length > 30){
        let u = a.slice(0,1)

        delete loaded[u]
    }
}

/**
 * Загрузить картинку в память
 */
function load(gen){
    if(gen !== loadGen) return

    if(loaded[src]){
        draw(loaded[src],bg(), false, gen)
    }
    else if(src){
        limit()

        cancelPendingImage()

        let cache_src = src
        let colors
        let img = new Image()
            pendingImg = img
            img.crossOrigin = "Anonymous"

            img.onload = function(){
                if(pendingImg === img) pendingImg = null

                if(gen !== loadGen) return

                try{
                    colors = Color.get(img)
                }
                catch(e){
                    colors = [
                        [200,200,200],
                        [100,100,100],
                        [10,10,10]
                    ]
                }

                loaded[cache_src] = {
                    img: img,
                    palette: Color.palette(colors)
                }

                draw(loaded[cache_src],bg(), false, gen)
            }

            img.onerror = ()=>{
                if(pendingImg === img) pendingImg = null

                if(gen !== loadGen) return

                draw(false, false, true, gen)
            }

            img.src = src
    }
}

/**
 * Изменить картинку
 * @param {string} url
 */
function change(url = ''){
    if(url == src || Storage.field('light_version') || !Storage.field('background')) return

    bokeh.d = true

    if(url) src = url

    clearTimeout(timer)
    cancelFade()
    cancelPendingImage()

    let gen = ++loadGen

    timer = setTimeout(()=>{
        if(gen !== loadGen) return

        if(url) load(gen)
        else draw(false, false, true, gen)
    },500)
}

/**
 * Изменить немедленно без ожидания
 * @param {string} url
 */
function immediately(url = ''){
    if(Storage.field('light_version') || immed_time + 1000 > Date.now() || !Storage.field('background')) return

    if(url) src = url

    clearTimeout(timer)
    cancelFade()
    cancelPendingImage()

    bokeh.d = false

    immed_time = Date.now()

    let gen = ++loadGen

    if(url) load(gen)
    else draw(false, false, true, gen)
}

function theme(color){
    if(color == 'black')      color = '#000000'
    else if(color == 'reset') color = '#1d1f20'

    if(color == theme_color) return

    theme_color = color
    
    theme_elem.attr('content', color)
}

/**
 * Рендер
 * @returns {object}
 */
function render(){
    return html
}

export default {
    render,
    change,
    update: resize,
    init,
    immediately,
    theme
}