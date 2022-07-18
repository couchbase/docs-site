module.exports = function (registry) {

    registry.treeProcessor(function () {

        const self = this

        self.process(function (document) {

            document.findBy({'context': 'olist', 'style': 'calloutlist'}, function (list) {

                list.context = list.node_name = 'colist'

            })
            return document
        })

    })
}
