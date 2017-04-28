ymaps.modules.define('ShapeLayer', [
    'Layer',
    'util.PrTree',
    'util.hd',
    'util.extend',
    'util.defineClass'
], function (provide, Layer, PrTree, utilHd, extend, defineClass) {
    var ShapeLayer = function (data, options) {
            ShapeLayer.superclass.constructor.call(this, '', extend({}, options, {
                tileTransparent: true
            }));
            this.__data = data.features || data;
            this.__shapeForm = this.options.get('shapeForm', 'circle');
            this.__clustered = this.options.get('clusterize', false);
            this.__gridMode = this.options.get('gridMode', 'fixed');
            this.__gridSize = this.options.get('gridSize', this.__gridMode != 'fixed' ? 64 : Math.pow(2, -8));

            this.__zoom = null;
            this.__projection = null;
            this.__shapes = null;
            this.__tree = null;

            this.__rebuildOnZoomChange = !this.__clustered || this.__gridMode != 'fixed';
        };

    defineClass(ShapeLayer, Layer, {
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
                var gridSize = typeof this.__gridSize == 'function' ?
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
                        grid[x][y] = [];
                    }
                    grid[x][y].push(feature);

                    return grid;
                }, {});
                clusters = [];

            Object.keys(grid).forEach(function (xKey) {
                var x = Number(xKey);
                Object.keys(grid[xKey]).forEach(function (yKey) {
                    var y = Number(yKey);
                    clusters.push({
                        objects: grid[xKey][yKey],
                        renderedGeometry: {
                            type: 'Point',
                            coordinates: [
                                (x + 0.5) * gridSize,
                                (y + 0.5) * gridSize
                            ],
                            zoom: zoom
                        },
                        bbox: [
                            [x * gridSize, y * gridSize],
                            [(x + 1) * gridSize, (y + 1) * gridSize]
                        ]
                    });
                });
            });

            return clusters;
        },

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
            var dpr = utilHd.getPixelRatio(),
                projection = this.__projection,
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
                        globalPixelPosition = this.__getShapePosition(shape, zoom);

                    switch (this.__shapeForm) {
                        case 'circles':
                            var radius = Math.floor(size / 2);

                            context.fillStyle = fillColor;

                            if (radius > 0) {
                                context.beginPath();
                                context.arc(
                                    Math.round((globalPixelPosition[0] - offset[0]) * dpr),
                                    Math.round((globalPixelPosition[1] - offset[1]) * dpr),
                                    radius * dpr,
                                    0,
                                    2 * Math.PI,
                                    false
                                );
                                context.closePath();
                                context.fill();
                            } else {
                                context.fillRect(Math.round(dpr * globalPixelPosition[0]), Math.round(dpr * globalPixelPosition[1]), 1, 1);
                            }

                            break;
                        case 'squares':
                            var left = Math.round(globalPixelPosition[0] - offset[0] - size / 2),
                                top = Math.round(globalPixelPosition[1] - offset[1] - size / 2);

                            context.fillStyle = fillColor;

                            if (size >= 8 && size < tileSize) {
                                var innerSize = Math.round(dpr * (size - 2)),
                                    outerSize = Math.round(dpr * (size - 1));

                                context.lineWidth = 1;
                                context.fillRect(dpr * (left + 2), dpr * (top + 2), innerSize, innerSize);
                                context.strokeStyle = '#acb78e';
                                context.strokeRect(dpr * (left + 1), dpr * (top + 1), outerSize, outerSize);
                                context.strokeStyle = '#bebd7f';
                                context.strokeRect(dpr * left, dpr * top, innerSize, innerSize);
                            } else {
                                context.fillRect(dpr * left, dpr * top, Math.round(dpr * size), Math.round(dpr * size));
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
            return this.__extractOption(shape, zoom, 'size', this.__gridSize * Math.pow(2, zoom));
        },

        __getShapeFillColor: function (shape, zoom) {
            return this.__extractOption(shape, zoom, 'fillColor', 'rgba(0, 255, 0, 0.8)');
        },

        __getShapePosition: function (shape, zoom) {
            if (shape.renderedGeometry) {
                var scale = Math.pow(2, zoom - shape.renderedGeometry.zoom);
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
                    globalOption(shape.objects, zoom) :
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