/**
 * @fileOverview
 * A Yandex Maps API Module to draw huge number of geo objects upon map.
 */
ymaps.modules.define('ShapeLayer', [
    'Layer',
    'util.PrTree',
    'util.hd',
    'util.extend',
    'util.defineClass'
], function (provide, Layer, PrTree, utilHd, extend, defineClass) {
    var dpr = utilHd.getPixelRatio();
        
        /**
         * @class Creates a Shape Layer
         * @augments Layer
         * @param {Object} data A data to be drawn in formatted
         * as GeoJSON FeatureCollection comprising Point geometries.
         * @param {Object} [options] Drawing options.
         * @param {String} [options.shapeForm='circles'] Form of shapes
         * to be drawn. Could be either 'circles' or 'squares'.
         * @param {Boolean} [options.clusterize=false] Whether on not
         * clusterize objects using grid.
         * @param {String} [options.gridMode='fixed'] 'fixed' — in clustered mode
         * grid cells always cover the same therritory in geometrical sence, i.e.
         * visible cell size is doubled when zoom increased by 1; 'flexible' —
         * grid cell geometrical area changes on every zoom change.
         * @param {String} [centroidMode='fixed'] 'fixed' — in clustered mode a shape
         * corresponding to a cluster is always drawn in a center of a grid cell;
         * 'avg' — a shape is drawn in an average position of all geometries in a cluster.
         * @param {Number|Function} [options.gridSize] A size of a grid cell
         * in clustered mode. Default value is 64 pixels when in 'flexible' grid mode
         * (i.e. cluster visible area is always 64 pixels on any zoom level), 1/64th
         * of pixel when in 'fixed' grid mode (i.e. on 8th zoom level grid size is exactly
         * 1 pixel, on 9th zoom — 2 pixels, and so on). Could be passed as a function
         * which gets one parameter (zoom level) and returns a grid size corresponding to
         * this zoom level.
         * @param {Number|Function} [options.size] A size of a cluster in clustered mode.
         * If not specified, cluster size is equal to grid size. Could be passed as a function
         * which gets two parameters ({@link IClusterJSON} describing cluster and a zoom level)
         * and returns a cluster size in pixels. Also, this option could be used to overwrite
         * sizes of individual objects (e.g. when not in clustered mode): by default size
         * of an object is taken from options.size field of the object itself; if absent, global
         * option will be used passing the object and zoom level as parameters.
         * @param {Number|Function} [options.color] A color of a cluster in clustered mode.
         * Could be passed as a function which gets two parameters
         * ({@link IClusterJSON} describing cluster and a zoom level) and returns
         * a cluster color in any form eligible for fillStyle property of canvas 2d context,
         * including gradients. Also, this option could be used to overwrite
         * colots of individual objects (e.g. when not in clustered mode): by default color
         * of an object is taken from options.color field of the object itself; if absent, global
         * option will be used passing the object and zoom level as parameters.
         */
    var ShapeLayer = function (data, options) {
            ShapeLayer.superclass.constructor.call(this, '', extend({}, options, {
                tileTransparent: true
            }));
            this.__data = data.features || data;
            this.__shapeForm = this.options.get('shapeForm', 'circle');
            this.__clustered = this.options.get('clusterize', false);
            this.__gridMode = this.options.get('gridMode', 'fixed');
            this.__centroidMode = this.options.get('centroidMode', 'fixed')
            this.__gridSize = this.options.get('gridSize', this.__gridMode != 'fixed' ? 64 : Math.pow(2, -8));

            this.__zoom = null;
            this.__projection = null;
            this.__shapes = null;
            this.__tree = null;
            this.__computedGridSize = null;

            this.__rebuildOnZoomChange = !this.__clustered || this.__gridMode != 'fixed';
        };
    
    /**
     * @class A JSON Object describing a cluster of objects.
     * @name IClusterJSON
     */

    /**
     * An array of object which fall into this cluster.
     * @name objects
     * @type {Object[]}
     * @field
     */

    /**
     * A rendered (i.e. pixel) geometry. Contains three fields:
     * type — a geometry type, always equal to 'Point';
     * geometry — a pixel point corresponding to centroid of the claster.
     * @name renderedGeometry
     * @type {Object}
     * @field
     */

    /**
     * A bounding box of an object, in rendered coordinates.
     * @name bbox
     * @type {Number[][]}
     * @field
     */

    /**
     * Zoom level, for which all coordinates are rendered.
     * @name zoom
     * @type {Number}
     * @field
     */

    defineClass(ShapeLayer, Layer, /** @lends ShapeLayer.prototype */ {
        getTileUrl: function (tileNumber, zoom) {
            this.__projection = this.getMap().options.get('projection');

            if (this.__zoom === null || this.__zoom != zoom) {
                this.__zoom = zoom;
                if (!this.__tree || this.__rebuildOnZoomChange) {
                    this.__buildPrTree(this.__rebuildOnZoomChange ? this.__zoom : 0);
                }
            }
            return this.__renderTile(tileNumber, zoom);
        },

        __buildPrTree: function (zoom) {
            var tree = this.__tree = new PrTree();
            
            this.__treeZoom = zoom;

            if (this.__clustered) {
                var gridSize = this.__computedGridSize = typeof this.__gridSize == 'function' ?
                        this.__gridSize(zoom) :
                        this.__gridSize;
                this.__shapes = this.generateClusters(zoom, gridSize);
            } else {
                this.__shapes = this.__data.map(function (feature) {
                    return {
                        object: feature,
                        bbox: this.getShapeBbox(feature, zoom)
                    };
                }.bind(this)).filter(function (feature) {
                    return feature.bbox != null;
                });
            }

            tree.insert(this.__shapes);
        },

        generateClusters: function (zoom, gridSize) {
            var projection = this.__projection,
                grid = this.__data.reduce(function (grid, feature) {
                    var position = projection.toGlobalPixels(feature.geometry.coordinates, zoom),
                        x = Math.floor(position[0] / gridSize),
                        y = Math.floor(position[1] / gridSize);
                    if (!grid[x]) {
                        grid[x] = {};
                    }
                    if (!grid[x][y]) {
                        grid[x][y] = {
                            sumX: 0,
                            sumY: 0,
                            count: 0,
                            objects: []
                        };
                    }

                    var cell = grid[x][y];
                    cell.sumX += position[0];
                    cell.sumY += position[1];
                    cell.count++;
                    cell.objects.push(feature);

                    return grid;
                }, {});
                clusters = [],
                fixedCentroid = this.__centroidMode == 'fixed';

            Object.keys(grid).forEach(function (xKey) {
                var x = Number(xKey);
                Object.keys(grid[xKey]).forEach(function (yKey) {
                    var y = Number(yKey),
                        cell = grid[xKey][yKey];
                    clusters.push({
                        objects: grid[xKey][yKey].objects,
                        renderedGeometry: {
                            type: 'Point',
                            coordinates: fixedCentroid ? [
                                (x + 0.5) * gridSize,
                                (y + 0.5) * gridSize
                            ] : [
                                cell.sumX / cell.count,
                                cell.sumY / cell.count
                            ]
                        },
                        bbox: [
                            [x * gridSize, y * gridSize],
                            [(x + 1) * gridSize, (y + 1) * gridSize]
                        ],
                        zoom: zoom
                    });
                });
            });

            return clusters;
        },

        /**
         * @param {Number[]} coords Geographical coordinates.
         * @returns {Object[]} An array of object which contains the geographical point passed.
         */
        getObjectsInPosition: function (coords) {
            var position = this.__projection.toGlobalPixels(coords, this.__treeZoom),
                scale = Math.pow(2, this.__treeZoom - this.getMap().getZoom()),
                shapes = this.__tree && this.__tree.search([
                    position, [
                        position[0] + scale,
                        position[1] + scale
                    ]
                ]) || [];
            
            if (shapes.length) {
                if (this.__clustered) {
                    return shapes.reduce(function (shapes, cluster) {
                        if (cluster.objects.length) {
                            shapes = [].concat(shapes, cluster.objects);
                        }
                        return shapes;
                    }, [])
                } else {
                    return shapes.map(function (shape) {
                        return shape.object;
                    });
                }
            }

            return [];
        },
        
        getShapeBbox: function (object, zoom) {
            var projection = this.__projection,
                center = projection.toGlobalPixels(object.geometry.coordinates, zoom),
                size = this.__extractOption({
                    object: object
                }, zoom, 'size'),
                left,
                top,
                right,
                bottom;

            switch (this.__shapeForm) {
                case 'circles':
                    var radius = Math.floor(size / 2);
                    if (size > 1) {
                        left = center[0] - radius;
                        top = center[1] - radius;
                        right = center[0] + radius;
                        bottom = center[1] + radius;
                    } else {
                        left = center[0];
                        top = center[1];
                        right = left + 1;
                        bottom = top + 1;
                    }
                    break;
                default:
                    return null;
            }

            return size >= 1 ? [[
                left,
                top
            ], [
                right,
                bottom
            ]] : null;
        },

        __renderTile: function (tileNumber, zoom) {
            var projection = this.__projection,
                x = tileNumber[0],
                y = tileNumber[1],
                tileSize = this.options.get('tileSize', 256),
                offset = [
                    x * tileSize,
                    y * tileSize
                ],
                canvas = document.createElement('canvas'),

                scale = Math.pow(2, this.__treeZoom - zoom),
                shapes = this.__tree.search([[
                    offset[0] * scale,
                    offset[1] * scale
                ], [
                    (offset[0] + tileSize) * scale,
                    (offset[1] + tileSize) * scale
                ]]),

                clustered = this.__clustered,
                shapeForm = this.__shapeForm;

            canvas.height = canvas.width = tileSize * dpr;

            if (shapes.length) {
                var context = canvas.getContext('2d');

                shapes.forEach(function (shape) {
                    var size = this.__getShapeSize(shape, zoom),
                        fillColor = this.__getShapeFillColor(shape, zoom),
                        globalPixelPosition = this.__getShapePosition(shape, zoom),
                        position = [
                            (globalPixelPosition[0] - offset[0]) * dpr,
                            (globalPixelPosition[1] - offset[1]) * dpr
                        ];

                    switch (this.__shapeForm) {
                        case 'circles':
                            var radius = Math.floor(size / 2);

                            context.fillStyle = fillColor;

                            if (radius > 0) {
                                context.beginPath();
                                context.arc(
                                    Math.round(position[0]),
                                    Math.round(position[1]),
                                    radius * dpr,
                                    0,
                                    2 * Math.PI,
                                    false
                                );
                                context.closePath();
                                context.fill();
                            } else {
                                context.fillRect(
                                    Math.floor(position[0]),
                                    Math.floor(position[1]),
                                    dpr,
                                    dpr
                                );
                            }

                            break;
                        case 'squares':
                            var left = Math.floor(position[0] - size * dpr / 2),
                                top = Math.floor(position[1] - size * dpr / 2);

                            context.fillStyle = fillColor;

                            if (size >= 8 && size < tileSize) {
                                var innerSize = Math.round(dpr * (size - 2)),
                                    outerSize = Math.round(dpr * (size - 1));

                                context.lineWidth = 1;
                                context.fillRect(left + 2 * dpr, top + dpr * 2, innerSize, innerSize);
                                context.strokeStyle = '#acb78e';
                                context.strokeRect(left + dpr, top + dpr, outerSize, outerSize);
                                context.strokeStyle = '#bebd7f';
                                context.strokeRect(left, top, innerSize, innerSize);
                            } else {
                                context.fillRect(
                                    left,
                                    top,
                                    Math.round(dpr * size),
                                    Math.round(dpr * size)
                                );
                            }

                            break;
                        default:
                            break;
                    }
                }.bind(this));
            }

            return canvas.toDataURL();
        },

        __getShapeSize: function (shape, zoom) {
            return this.__extractOption(shape, zoom, 'size',
                this.__clustered ? 
                    this.__computedGridSize * Math.pow(2, zoom - this.__treeZoom) :
                    0
            );
        },

        __getShapeFillColor: function (shape, zoom) {
            return this.__extractOption(shape, zoom, 'fillColor', 'rgba(0, 255, 0, 0.8)');
        },

        __getShapePosition: function (shape, zoom) {
            if (shape.renderedGeometry) {
                var scale = Math.pow(2, zoom - shape.zoom);
                return [
                    shape.renderedGeometry.coordinates[0] * scale,
                    shape.renderedGeometry.coordinates[1] * scale
                ];
            } else {
                return this.__projection.toGlobalPixels(shape.object.geometry.coordinates, zoom);
            }
        },

        __extractOption: function (shape, zoom, key, defaultValue) {
            var globalOption = this.options.get(key);

            if (this.__clustered) {
                return typeof globalOption == 'function' ?
                    globalOption(shape, zoom) :
                    defaultValue;
            } else {
                var object = shape.object,
                    value = object.options && object.options[key] || globalOption;
                
                if (typeof value == 'function') {
                    value = value(object, zoom);
                }

                return value;
            }
        }
    });

    provide(ShapeLayer);
});