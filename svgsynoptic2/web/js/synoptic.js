Synoptic = (function () {

    // This represents the whole "synoptic" widget and all interactions
    function Synoptic (container, svg_, config) {

        config = config || {};

        var svg_copy = svg_.node().cloneNode(true);
                
        // the View takes care of the basic navigation; zooming,
        // panning etc, and switching between detail levels.
        var view = new View(container, svg_, config.view);

        var svg = svg_.node();
        
        this.container = container;
        
        // whenever the user zooms or pans the view, we need to update the
        // listeners etc. But since this is a pretty expensive and slow
        // operation, we'll only do it once the user has stopped moving
        // around for a bit.
        view.addCallback(_.debounce(updateVisibility, 500, {leading: false}));

        // // this is a debugging tool; uncomment it to be able to see the
        // // current part of the image that the synoptic considers as "visible"
        /* var viewRect = svg_.select("svg > g")
         *                    .append("rect")
         *                    .style("fill", "yellow")
         *                    .style("stroke-width", "5%")
         *                    .style("stroke", "red")
         *                    .style("opacity", 0.3);
         * var viewRectText = svg_.select("svg > g").append("text")
         *                        .text("test")
         *                        .style("font-size", "100")
         *                        .attr("dy", 100);
         * view.addCallback(_.debounce(function (bbox) {
         *     viewRect.attr(bbox);
         *     viewRectText
         *         .attr("x", bbox.x)
         *         .attr("y", bbox.y)
         *         .text(Math.round(bbox.width) + ", " + Math.round(bbox.height))
         * }, 500));*/
        
        /********** optional plugins **********/
        // The plugins are only added if they are loaded from the HTML file.
        // TODO: Figure out a more flexible way to load these, to make
        // it possible to add custom plugins.
        
        if (window.LayerTogglers) {
            var layers = new LayerTogglers(container, svg_, config.layers);
            layers.addCallback(function () {updateVisibility();});
        }
            
        if (window.Thumbnail)
            var thumbnail = new Thumbnail(container, view, d3.select(svg_copy),
                                          config.thumbnail);
        
        if (window.Tooltip) {
            var tooltip = new Tooltip(container, view, svg);
        }

        // if (window.Notes) {
        //     var notes = new Notes(container, view, []);
        // }
        
        /********** Utils **********/
        
        var selectNodes = function (type, name) {
            // return a selection containing all elements of that
            // has a <type> (e.g. "model") called <name>.
            
            // Note that we can't make any assumptions about the letter casing
            // of the model names, as there can be differences between what's
            // used in the database and in the SVG. So we must normalize to
            // compare.

            var selector = "." + type + '[data-' + type + '-normalized="' + name.toLowerCase().replace(/"/g, '\\22') + '"]';
            return svg.querySelectorAll(selector);
        };

        /********** Input events **********/
        // this is where we keep all registered callbacks for things
        // like mouseclicks
        
        var listeners = {
            "click": [],
            "contextmenu": [],
            "subscribe": [],
            "unsubscribe": [],
            "hover": []
        };

        // run any registered callbacks for a given event and item type
        function fireEventCallbacks(eventType, data) {
            if (listeners[eventType])
                listeners[eventType].forEach(function (cb) {cb(data);});
        }

        function getTypeFromData(el) {
            if (el.section)
                return "section";
            if (el.model)
                return "model";
        }

        function getDataset (event) {
            // this differs between FF and webkit...
            if (event.target instanceof SVGElementInstance) {
                return event.target.correspondingUseElement.dataset;
            } else {
                return event.target.dataset;
            }
        }
        
        // TODO: refactor, this probably belongs in the View...
        function setupMouse () {
            
            // Note: it would be nicer to put these callbacks on the
            // SVG element instead of on each and every clickable
            // element. But for some reason this does not work in
            // qtwebkit, the d3.event.target does not get set to the
            // correct element.  It works in FF and Chrome so it's
            // likely to be a bug in older webkit versions.

            // leftclick
            util.forEach(svg.querySelectorAll(".section, .model"), function (node) {
                node.addEventListener("click", function (event) {
                    if (event.defaultPrevented) return;
                    // Only makes sense to click items with data
                    console.log(event);
                    fireEventCallbacks("click", getDataset(event));
                });
                // rightclick
                node.addEventListener("contextmenu", function (event) {
                    if (event.defaultPrevented) return false;
                    fireEventCallbacks("contextmenu", getDataset(event));
                    return false;
                });
                // hover
                node.addEventListener("mouseover", function (event) {
                    fireEventCallbacks("hover", getDataset(event));
                });
                node.addEventListener("mouseout", function (d) {
                    fireEventCallbacks("hover", null);
                });
            });
        }

        setupMouse();

        // mark a model (could be several items) as "selected"
        // Currently, we draw a circle and place it behind the node.
        function markModel (models) {
            models.forEach(function(model) {
                var nodes = selectNodes("model", model);
                util.forEach(nodes, function (node) {
                    var marker = document.createElementNS(
                        "http://www.w3.org/2000/svg", "ellipse");
                    var bbox = util.transformedBoundingBox(node);
                    marker.setAttribute("cx", bbox.x + bbox.width/2);
                    marker.setAttribute("cy", bbox.y + bbox.height/2);
                    marker.setAttribute("rx", bbox.width);
                    marker.setAttribute("ry", bbox.height);
                    marker.setAttribute("class", "selection");
                    node.parentNode.insertBefore(marker,
                                                 node.parentNode.firstChild);
                });
            });
        }

        /********** Tango events **********/

        // update CSS classes on selected nodes
        function setClasses(type, name, classes) {
            util.forEach(selectNodes(type, name),
                         function(node){
                             Object.keys(classes).forEach(function (cl) {
                                 util.setClass(node, cl, classes[cl]);
                             });
                         });
        }        

        // update the dataset attribute on selected nodes
        function setData(type, name, data) {
            util.forEach(selectNodes(type, name),
                        function (node) {
                            _.extend(node.dataset, data);
                        });
        }
        
        /********** Visibility **********/

        var _bboxes = {device: {}, attribute: {}, section: {}};

        // return whether a given element is currently in view
        function isInView(bboxes, vbox) {
            if (!bboxes)
                return false;
            vbox = container.getBoundingClientRect();
            /*             console.log("vbox " +  vbox.left);*/
            return bboxes.some(function (bbox) {
                return (bbox.right > vbox.left &&
                        bbox.top < vbox.bottom &&
                        bbox.left < vbox.right &&
                        bbox.bottom > vbox.top);
            });
        }

        // calculate the "bounding box" (smallest encompassing rectangle) for
        // all nodes with a given type and name. This is used for checking if
        // the element is in view or not.
        function getBBox (type, name) {
            var bboxes = [];
            var nodes = selectNodes(type, name);
            try {
                util.forEach(nodes, function (node) {
                    var bbox = node.getBoundingClientRect();
                    // we'll also store the bbox in the node's data for easy
                    // access. 
                    bboxes.push(bbox);
                });
                return bboxes;
            } catch (e) {
                // This probably means that the element is not displayed.
                return [];
            }
        }
        // getBBox() gets used a lot (and the bboxes should never change),
        // so we memoize it
        /* var getBBox = _.memoize(_getBBox, function (a, b) {
         *     return (a + ":" + b).toLowerCase();
         * });*/
        
        // return a selection containing the devices in the currently
        // shown layers and zoom levels.
        function selectShownThings() {
            return svg.querySelectorAll(
                "g.layer:not(.hidden) > .model, " +
                    "g.layer:not(.hidden) > g:not(.zoom) .model, " +
                    "g.layer:not(.hidden) > g.zoom:not(.hidden) .model"
            );
        }
        
        // Hmm... this does not quite work
        function selectHiddenThings() {
            return svg.selectAll(
                "g.layer.hidden .model, g.zoom.hidden > .model"
            );
        }
        
        function fireSubscribeCallbacks(visible) {
            listeners.subscribe.forEach(
                function (cb) {
                    try {
                        cb(visible);
                    } catch (e) {
                        console.log("Error subscribing to", visible, e);
                    }
                });
        }
                
        // Find all devices that can be seen and activate them
        function updateVisibility (vbox) {
            
            vbox = vbox || view.getViewBox();

            var sel = selectShownThings();
            var visibleNodes = [];
            util.forEach(sel, function (node) {
                var bbox = getBBox("model", node.dataset.model),
                    visible = isInView(bbox, vbox);
                util.setClass(node, "hidden", !visible);
                if (visible) visibleNodes.push(node.dataset.model);
            });

            fireSubscribeCallbacks(visibleNodes);
            
        }

        function zoomTo (type, name) {
            console.log("zoomTo " + type + " " + name);            
            var sel = selectNodes(type, name);
            var node = sel[0];
            // here we want the coordinates in SVG space
            var bbox = util.transformedBoundingBox(node);
            console.log("bbox " + bbox.left + " " + bbox.top + " " +bbox.height + " " + bbox.width);
            view.moveToBBox(bbox, 200, 0.25);
        };

        
        /********** API **********/

        this.addEventCallback = function (eventType, callback) {
            listeners[eventType].push(callback);
            
            if (eventType == "subscribe")
                updateVisibility;
        };

        // TODO: removeEventCallback()
        
        this.zoomTo = zoomTo;
        
        this.select = function (type, name) {
            switch (type) {
            case "model":
                //names.forEach(selectModel);
                markModel(name);
                break;
            }
        };

        this.unselectAll = function () {
            util.forEach(svg.querySelectorAll(".selection"),
                         function (node) {node.remove();});
        };

        this.setClasses = function (type, name, classes) {
            setClasses(type, name, classes);
        };

        this.setData = function (type, name, data) {
            setData(type, name, data);
        };
        
        this.setText = function (type, name, text) {
            util.forEach(selectNodes(type, name),
                         function (node) {node.textContent = text;});
        }

        this.showTooltip = function () {
            if (tooltip)
                tooltip.open()
        }

        this.hideTooltip = function () {
            if (tooltip)            
                tooltip.close();
        }
        
        this.setTooltipHTML = function (html) {
            if (tooltip)            
                tooltip.setHTML(html);
        }

        this.setNotes = function (data) {
            if (notes) {
                var notedata = JSON.parse(data);
                notes.setData(notedata);
            }
        }

        this.newNote = function (data) {
            if (notes) {
                var notedata = JSON.parse(data);
                notes.addNote(notedata);
            }
        }
        
        this.getModels = function () {
            var models = [];
            svg.selectAll(".model").each(function (d) {models.append(d.model)});
            return models;
        }
       
    }

    return Synoptic;

})();
