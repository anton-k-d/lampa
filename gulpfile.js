/** Что-бы все не пропало! **/
process.on('uncaughtException', function (err) {
    console.log(err)
    if (process.env.LAMPA_BUILD === '1') process.exitCode = 1;
});


const { src, dest, series, parallel } = require('gulp');

var concat         = require('gulp-concat'),
    chokidar       = require('chokidar'),
    uglify         = require('gulp-uglify-es').default,
    uglifycss      = require('gulp-uglifycss'),
    browser        = require('browser-sync').create(),
    newer          = require('gulp-newer'),
    sass           = require('gulp-sass')(require('sass')),
    autoprefixer   = require('gulp-autoprefixer'),
    fileinclude    = require('gulp-file-include'),
    replace        = require('gulp-replace'),
    fs             = require('fs'),
    worker         = require('rollup-plugin-web-worker-loader'),
    crypto         = require('crypto');

var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var rollup = require('@rollup/stream');
var path   = require('path');
var pipeline = require('stream').pipeline;

var doctrine = require('doctrine');

// *Optional* Depends on what JS features you want vs what browsers you need to support
// *Not needed* for basic ES6 module import syntax support
var babel = require('@rollup/plugin-babel').babel;
// Add support for require() syntax
var commonjs = require('@rollup/plugin-commonjs');
// Add support for importing from node_modules folder like import x from 'module-name'
var nodeResolve = require('@rollup/plugin-node-resolve').nodeResolve;
var regenerator = require('rollup-plugin-regenerator');


var cache;

var srcFolder = './src/';
var dstFolder = './dest/';
var pubFolder = './public/';
var bulFolder = './build/';
var idxFolder = './index/';
var plgFolder = './plugins/';
var docFolder = './build/doc/';

var isDebugEnabled = false;

function merge() {
    let plugins = [babel({
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env']
    }), commonjs(), nodeResolve(), worker()]

    return new Promise((resolve, reject) => pipeline(
      rollup({
        // Point to the entry file
        input: srcFolder+"app.js",

        // Apply plugins
        plugins: plugins,

        // Use cache for better performance
        //cache: cache,

        // Note: these options are placed at the root level in older versions of Rollup
        output: {
          // Output bundle is intended for use in browsers
          // (iife = "Immediately Invoked Function Expression")
          format: 'iife',
          sourcemap: isDebugEnabled ? 'inline' : false
        },

        onwarn: function ( message ) {
            return;
        }
      }),
      source('app.js'), buffer(),
      replace(/return kIsNodeJS/g, "return false"),
      replace(/return kIsNodeJS/g, "return false"),
      dest(dstFolder),
      error => error ? reject(error) : resolve()
    ));
}

function bubbleFile(name){
    let plug = [babel({
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env']
    }), commonjs(), nodeResolve()]

    rollup({
        input: plgFolder+name,
        plugins: plug,
        output: {
          format: 'iife',
          sourcemap: isDebugEnabled ? 'inline' : false,
          sourcemapPathTransform: isDebugEnabled ? pluginSourcemapPathTransform : undefined
        },
        onwarn: function ( message ) {
            return;
        }
      })
      .pipe(source(name))
      .pipe(buffer())
      .pipe(fileinclude({
        prefix: '@@',
        basepath: '@file'
      }))
      .pipe(dest(dstFolder));
}

function getFileHash(path) {
    const fileBuffer = fs.readFileSync(path);
    const hashSum = crypto.createHash('md5');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

function plugins(done) {
    fs.readdirSync(plgFolder).filter(function (file) {
        return fs.statSync(plgFolder+'/'+file).isDirectory();
    }).forEach(folder => {
        bubbleFile(folder+'/'+folder+'.js')

        plugin_sass(plgFolder+'/'+folder)
    });
      
    done();
}

function plugin_sass(plugin_src){
    return src(plugin_src+'/css/*.scss')
        .pipe(process.env.LAMPA_BUILD === '1' ? sass.sync() : sass.sync().on('error', sass.logError)) // Преобразуем Sass в CSS посредством gulp-sass
        .pipe(autoprefixer(['last 100 versions', '> 1%', 'ie 8', 'ie 7', 'ios 6', 'android 4'], { cascade: true })) // Создаем префиксы
        .pipe(uglifycss({
            "maxLineLen": 80,
            "uglyComments": true
        }))
        .pipe(replace(/\n/g, ''))
        .pipe(replace(/"/g, "'"))
        .pipe(dest(plugin_src+'/css'))
}

var copy_timer;

/** Обновляем файл для WEB **/
function build_web(done){
    clearTimeout(copy_timer)

    //таймер сила!
    copy_timer = setTimeout(()=>{
        //src([dstFolder+'app.js']).pipe(dest(bulFolder+'web/'));

        let date      = new Date();
        let full_date = date.getFullYear() + '-' +
                        ('0' + (date.getMonth()+1)).slice(-2) + '-' +
                        ('0' + date.getDate()).slice(-2) + ' ' +
                        ('0' + date.getHours()).slice(-2) + ':' +
                        ('0' + date.getMinutes()).slice(-2);

        src(dstFolder+'app.js')
            .pipe(replace('{__APP_HASH__}', getFileHash(dstFolder + '/app.js')))
            .pipe(replace('{__APP_BUILD__}', full_date))
            .pipe(dest(bulFolder+'web/'));

        fs.readdirSync(dstFolder).filter(function (file) {
            return fs.statSync(dstFolder+'/'+file).isDirectory();
        }).forEach(folder => {
            src([dstFolder+folder+'/'+folder+'.js']).pipe(dest(bulFolder+'web/plugins'));
        });
    },500)

    done();
}

function write_manifest(done){
    var manifest = fs.readFileSync(srcFolder+'core/manifest.js', 'utf8')
    var hash     = getFileHash(dstFolder + '/app.js')

    var app_version = manifest.match(/app_version: '(.*?)',/)[1]
    var css_version = manifest.match(/css_version: '(.*?)',/)[1]

    var object = {
        app_version: app_version,
        css_version: css_version,
        css_digital: parseInt(css_version.replace(/\./g,'')),
        app_digital: parseInt(app_version.replace(/\./g,'')),
        time: buildDate().getTime(),
        hash: hash
    }

    console.log('assembly', object)

    fs.writeFileSync(bulFolder+'github/lampa/assembly.json', JSON.stringify(object, null, 4))

    done()
}

/** Публикуем для WEB платформы **/
function public_task(path){
    return src(dstFolder + '/app.min.js').pipe(dest(bulFolder+path));
}

function lang_task(){
    return src(srcFolder + '/lang/*.js').pipe(dest(pubFolder + '/lang'));
}

function stage_lang(){
    return src(srcFolder + '/lang/*.js').pipe(dest(dstFolder + '/staging/lang'));
}

function clean_staging(done){
    fs.rmSync(dstFolder + '/staging', { recursive: true, force: true });
    done();
}

function sync_staging(path){
    return src(dstFolder + '/staging/**/*').pipe(dest(bulFolder + path));
}

function stage_webos(){ return sync_staging('webos/'); }
function stage_github(){ return sync_staging('github/lampa/'); }

function public_webos(){
    return public_task('webos/');
}
function public_tizen(){
    return public_task('tizen/');
}
function public_github(){
    return public_task('github/lampa/');
}

function index_webos(){
    return src(idxFolder + '/webos/**/*').pipe(dest(bulFolder+'webos/'));
}
function index_tizen(){
    return src(idxFolder + '/tizen/**/*').pipe(dest(bulFolder+'tizen/'));
}
function index_github(){
    return src(idxFolder + '/github/**/*').pipe(dest(bulFolder+'github/lampa/'));
}

/** Сверяем файлы **/
function sync_task(path){
    return src([pubFolder + '**/*'])
        .pipe(newer(bulFolder+path))
        .pipe(dest(bulFolder+path));
}

function sync_web(){
    return sync_task('web/');
}
function sync_webos(){
    return sync_task('webos/');
}
function sync_tizen(){
    return sync_task('tizen/');
}
function sync_github(){
    return sync_task('github/lampa/');
}
function sync_doc(){
    return src([idxFolder + 'doc/' + '**/*'])
        .pipe(newer(docFolder))
        .pipe(dest(docFolder));
}

/** Следим за изменениями в файлах **/
function watch(done){
    var watcher = chokidar.watch([srcFolder,pubFolder,plgFolder], { persistent: true, ignored: [pubFolder + '/lang']});

    var timer;
    var change = function(path){
        clearTimeout(timer)

        if(path.indexOf('.css') > -1) return;

        timer = setTimeout(
            series(merge, plugins, sass_task, lang_task, sync_web, build_web)
        ,5000)
    }

    watcher.on('add', function(path) {
        console.log('File', path, 'has been added');

        change(path)
    })
    .on('change', function(path) {
        console.log('File', path, 'has been changed');

        change(path)
    })
    .on('unlink', function(path) {
        console.log('File', path, 'has been unlink');

        change(path)
    })

    done();
}

function browser_sync(done) {
    browser.init({
        server: {
            baseDir: bulFolder+'web/'
        },
        open: false,
        notify: false,
        ghostMode: false,
    });

    done();
}

function sass_task(){
    return src(srcFolder+'/sass/*.scss')
        .pipe(process.env.LAMPA_BUILD === '1' ? sass.sync() : sass.sync().on('error', sass.logError)) // Преобразуем Sass в CSS посредством gulp-sass
        .pipe(autoprefixer(['last 100 versions', '> 1%', 'ie 8', 'ie 7', 'ios 6', 'android 4'], { cascade: true })) // Создаем префиксы
        .pipe(dest(pubFolder+'/css'))
        .pipe(browser.reload({stream: true}))
}

function stage_sass(){
    return src(srcFolder+'/sass/*.scss')
        .pipe(sass.sync())
        .pipe(autoprefixer(['last 100 versions', '> 1%', 'ie 8', 'ie 7', 'ios 6', 'android 4'], { cascade: true }))
        .pipe(dest(dstFolder+'/staging/css'));
}

function buildDate() {
    const epoch = process.env.SOURCE_DATE_EPOCH;
    if (epoch === undefined) return new Date();
    if (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch)) || !Number.isFinite(new Date(Number(epoch) * 1000).getTime())) throw new Error('Invalid SOURCE_DATE_EPOCH');
    return new Date(Number(epoch) * 1000);
}

function uglify_task() {
    let date = buildDate();
    let full_date = process.env.SOURCE_DATE_EPOCH === undefined
        ? date.getFullYear() + '-' + ('0' + (date.getMonth()+1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2) + ' ' + ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2)
        : date.toISOString().slice(0, 16).replace('T', ' ');

    return src([dstFolder+'app.js'])
        .pipe(replace('{__APP_HASH__}', getFileHash(dstFolder + '/app.js')))
        .pipe(replace('{__APP_BUILD__}', full_date))
        .pipe(concat('app.min.js')).pipe(dest(dstFolder));


    return src([dstFolder+'app.js']).pipe(concat('app.min.js')).pipe(dest(dstFolder));
}

function test(done){
    lang_task()
    done();
}

function enable_debug_mode(done){
    console.log("build with sourcemaps!")
    isDebugEnabled = true;
    done()
}

/**
 * преобразует путь к исходному файлу
 * @param {string} relativeSourcePath 
 * @param {string} sourcemapPath 
 * @returns {string} a new path to source
 */
function pluginSourcemapPathTransform(relativeSourcePath, sourcemapPath) {
    const plgFolderLen = plgFolder.length-2;
    const newPath = relativeSourcePath.substring(plgFolderLen);
    return newPath;
}

function buildDoc(done){
    let data = []

    function scan(directory){
        let files = fs.readdirSync(directory)

        files.forEach(file => {
            let filePath = path.join(directory, file)
            let stat = fs.statSync(filePath)

            if (stat.isDirectory()) scan(filePath)
            else{
                let code = fs.readFileSync(filePath, 'utf8') + ''

                console.log('scan', filePath)

                let comments = code.match(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm)

                if(comments){
                    comments.forEach(comment => {
                        let parsedComment = doctrine.parse(comment, { unwrap: true });

                        if(parsedComment.tags.find(t=>t.title == 'doc')){
                            let params = parsedComment.tags.filter(t=>['doc','name','alias'].indexOf(t.title) == -1)
                            let category = parsedComment.tags.find(t=>t.title == 'alias')
                            let name = parsedComment.tags.find(t=>t.title == 'name')
                            
                            //console.log(JSON.stringify(parsedComment.tags, null, 4))
                            
                            data.push({
                                file: filePath,
                                params: params.map(p=>({param: p.name || p.title, desc: p.description || '', type: p.type ? p.type.name : 'any'})),
                                desc: parsedComment.description,
                                category: category ? category.name : 'other',
                                name: name ? name.name : 'unknown'
                            })
                        }
                    })
                }
            }
        })
    }
    
    scan(srcFolder)

    let doc = fs.readFileSync(idxFolder+'doc/index.html', 'utf8')

    doc = doc.replace('{data}', JSON.stringify(data))

    fs.writeFileSync(docFolder+'data.json', JSON.stringify(data))
    fs.writeFileSync(docFolder+'index.html', doc)

    done()
}

exports.prepare      = series(clean_staging, merge, stage_sass, stage_lang);
exports.pack_webos   = series(sync_webos, uglify_task, public_webos, index_webos);
exports.pack_tizen   = series(sync_tizen, uglify_task, public_tizen, index_tizen);
exports.pack_github  = series(sync_github, uglify_task, public_github, index_github, write_manifest);
exports.build_github = series(exports.prepare, exports.pack_github, stage_github);
exports.build_webos  = series(exports.prepare, exports.pack_webos, stage_webos);
exports.pack_plugins = series(plugins);
exports.test         = series(test);
exports.default = parallel(watch, browser_sync);
exports.debug = series(enable_debug_mode, this.default)
exports.doc = series(sync_doc, buildDoc)
exports.write_manifest = series(write_manifest)
