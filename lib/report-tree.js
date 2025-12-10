'use strict'
const path = require('node:path')
const groupBy = require('array.prototype.groupby')
const handlebars = require('handlebars')
const fs = require('fs')

module.exports.register = function ({ playbook, config }) {
    const logger = this.getLogger('report-tree')

    this.on('playbookBuilt', ({playbook}) => {
      try {
        const navGroups = JSON.parse(playbook.site.keys.navGroups)
        console.log(navGroups)
      }
      catch (e) {
        console.log(playbook.site.keys.navGroups)
        throw new Error(`keys.nav_groups is not a valid JSON object!\n${e}`)
      }
    })

    this.on('beforePublish', async ({ playbook, siteAsciiDocConfig, siteCatalog, uiCatalog, contentCatalog }) => {

        logger.info('Compiling report')

        const makeTag = (origin) => {
            const base = path.basename(origin.url, '.git')
            const startPath = origin.startPath ? `startPath=${origin.startPath}` : ''
            return `${base} (${origin.branch}) ${startPath}`
        }

        const makeGithubUrl = (src) =>
            src.editUrl.replace('/edit/', '/blob/')

        /*
         * We get every page in the contentCatalog, as a flat list.
         * We now want to turn this into a directory tree.
         * Each leaf (e.g. .html document) is annotated with an 'tag' like `component/version:start_path`
         */
        const pages = (
            contentCatalog
            .getPages()
            .filter(p => p.out) // only published pages
            .map((p) => ([
                p.out.path,
                makeTag(p.src.origin),
                makeGithubUrl(p.src),
                p.asciidoc.attributes])))

        const forReview = (p) => {
            const key = 'page-for-review'
            const attributes = p[3]
            return key in attributes && attributes[key] !== null
        }
        const pagesForReview = (
            pages
                .filter(forReview)
                .map(([p,_src,githubUrl,a]) => ({
                    $href: p,
                    $githubUrl: githubUrl,
                    $title: `${a['page-component-title']} > ${a.doctitle}`})))
        
        const makeLeaf = (leaf) => Object.fromEntries(
            leaf.map(
                ([p, src, githubUrl]) => [
                    path.basename(p),
                    {
                        $tag: src,
                        $href: p,
                        $githubUrl: githubUrl
                    }]))
        
        const branch = (pages, level=0) => {
            // group by the directory at this level
            // e.g. /server/7.1/learn would be
            //   [0] = "server"
            //   [1] = "7.1"
            //   [2] = "learn"
            //   [3] = "$leaf"  (a marker to show that this is an .html node)
            const g = groupBy(
                    pages,
                    ([p,_]) => path.dirname(p).split(path.sep)[level] ?? '$leaf')
                    
            const children = 
                Object.fromEntries(
                    Object.entries(g).map(
                        ([k,v]) =>
                            [k, 
                            k === '$leaf' ? makeLeaf(v) 
                                : branch(v, level+1)]))

            // Because we groupBy'd the $leaf nodes together, as if that was a
            // subdirectory, we now need to flatten them back into the main node
            const leaf = children.$leaf ?? {}
            delete children.$leaf
            const $children = {...children, ...leaf}
            
            // if the directory tree at this point has children with the same $tag
            // then inherit that from them
            var node = {$children}
            const TAG = Object.values($children)[0].$tag
            if (Object.values($children).every(({$tag}) => $tag === TAG)) {
                node.$tag = TAG
            } 

            return node
        }
    
        const tree = branch(pages)
        
        // Define a Handlebars helper to successively color every different 'tag' we see.
        // https://github.com/mina86/palette.js/blob/master/palette.js#LL810C5-L819C23
        const palette = [
        'ff0029', '377eb8', '66a61e', '984ea3', '00d2d5', 'ff7f00', 'af8d00',
        '7f80cd', 'b3e900', 'c42e60', 'a65628', 'f781bf', '8dd3c7', 'bebada',
        'fb8072', '80b1d3', 'fdb462', 'fccde5', 'bc80bd', 'ffed6f', 'c4eaff',
        'cf8c00', '1b9e77', 'd95f02', 'e7298a', 'e6ab02', 'a6761d', '0097ff',
        '00d067', '000000', '252525', '525252', '737373', '969696', 'bdbdbd',
        'f43600', '4ba93b', '5779bb', '927acc', '97ee3f', 'bf3947', '9f5b00',
        'f48758', '8caed6', 'f2b94f', 'eff26e', 'e43872', 'd9b100', '9d7a00',
        '698cff', 'd9d9d9', '00d27e', 'd06800', '009f82', 'c49200', 'cbe8ff',
        'fecddf', 'c27eb6', '8cd2ce', 'c4b8d9', 'f883b0', 'a49100', 'f48800',
        '27d0df', 'a04a9b' ]
        const colors = {}
        var i = 0
        const tagStyle = (tag) => {
            if (tag in colors) {
                return `class="tag" style="color: ${colors[tag]};"`
            }
            else {
                colors[tag] = palette[i++ % palette.length]
                return `class="tag tag-first" style="color: ${colors[tag]};"`
            }
        }

        // Compile the report
        handlebars.registerPartial('tree', fs.readFileSync("lib/report-tree-tree.hbs").toString())
        handlebars.registerHelper('tagStyle', tagStyle)
        
        const template = handlebars.compile(
            fs.readFileSync("lib/report-tree.hbs").toString())

        let pr = fs.existsSync('pr.json') ?
            JSON.parse(fs.readFileSync('pr.json')) : null

        if (pr) {
            const md = require('markdown-it')({linkify: true})
            pr.body = md.render(pr.body)
        }
        
        const data = {
            date: Date(),
            tree,
            pagesForReview,
            pr
        }

        const page = template(data)

        siteCatalog.addFile({
          contents: Buffer.from(page),
          out: { path: 'doctor/tree.html' } })

        const {env, git, ...rest} = playbook
        const {credentials, ...gitrest} = git
        const playbook_clean = {git: gitrest, ...rest}

        siteCatalog.addFile({ contents:
          Buffer.from(JSON.stringify(playbook_clean)),
          out: { path: 'doctor/antora-playbook.json' } })

        fs.writeFileSync('record.json', JSON.stringify({pagesForReview, pr}))
    })

        
    this.on('sitePublished', ({contentcatalog, publications}) => {
        const doctorPath = '/doctor/tree.html'
        const log = (msg) => process.stdout.write(msg + '\n')

        publications.forEach((pub) => {
            const baseUri = pub?.fileUri
            if (baseUri) {
                log(`Open ${baseUri}${doctorPath} in a browser to view the doctor's report.`)
            }
        })
    })
}




