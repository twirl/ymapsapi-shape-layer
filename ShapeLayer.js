ymaps.modules.define('ShapeLayer', [
    'Layer',
    'hotspot.Layer',
    'util.hd',
    'util.extend',
    'util.defineClass'
], function (provide, Layer, HotspotLayer, utilHd, extend, defineClass) {
    var ShapeLayer = function (data, options) {
            ShapeLayer.superclass.constructor.call(this, '', extend({}, options, {
                tileTransparent: true
            }));
            this.__data = data;
            this.__zoom = null;
            this.__grid = null;
            this.__mode = this.options.get('mode', 'circles');
        };

    defineClass(ShapeLayer, Layer, {
        getTileUrl: function (tileNumber, zoom) {
            if (this.__zoom === null || this.__zoom != zoom) {
                this.__zoom = zoom;
                this.__generateGrid(zoom);
            } else {
                var currentTileRange = this.__getTileRange(zoom);
                if (rangesDiffer(this.__tileRange, currentTileRange)) {
                    this.__tileRange = currentTileRange;
                    this.__generateGrid(zoom);
                }
            }
            return this.__renderTile(tileNumber, zoom);
        },

        getObjectsInPosition: function (coords) {
            var position = this.getMap().options.get('projection').toGlobalPixels(coords, this.__zoom),
                tileSize = this.options.get('tileSize', 256),
                x = Math.floor(position[0] / tileSize),
                y = Math.floor(position[1] / tileSize),
                objects = this.__grid[x] && this.__grid[x][y],
                res = [];

            switch(this.__mode) {
                case 'circles':
                    if (objects.length) {
                        for (var i = 0; i < objects.length; i++) {
                            var object = this.__data[objects[i]];
                            if (this.__contains(object, position)) {
                                res.push(object);
                            }
                        }
                    }
                    break;
                case 'grid':
                    var gridX = Math.floor((position[0] - x * tileSize) / this.__gridSize),
                        gridY = Math.floor((position[1] - y * tileSize) / this.__gridSize);
                    if (objects && objects[gridX] && objects[gridX][gridY]) {
                        res = objects[gridX][gridY];
                    }
                    break;
            }

            return res;
        },

        __generateGrid: function (zoom) {
            if (this.__mode == 'grid') {
                this.__gridSize = this.options.get('gridSize') * Math.pow(2, zoom);
            }

            var grid = {},
                projection = this.getMap().options.get('projection'),
                tileSize = this.options.get('tileSize', 256),
                tileRange = this.__tileRange = this.__getTileRange(zoom);

            this.__data.forEach((object, index) => {
                var tileBounds = this.__getObjectTileBounds(object, projection, zoom);

                if (tileBounds) {
                    for (var x = tileBounds[0][0]; x <= tileBounds[1][0]; x++) {
                        for (var y = tileBounds[0][1]; y <= tileBounds[1][1]; y++) {
                            if (x >= tileRange[0][0] && x <= tileRange[1][0] &&
                                y >= tileRange[0][1] && y <= tileRange[1][1]) {
                                if (!grid[x]) {
                                    grid[x] = {};
                                }
                                switch (this.__mode) {
                                    case 'circles':
                                        if (!grid[x][y]) {
                                            grid[x][y] = [];
                                        }
                                        grid[x][y].push(index);
                                        break;
                                    case 'grid':
                                        var offset = [
                                                x * tileSize,
                                                y * tileSize
                                            ],
                                            position = projection.toGlobalPixels(
                                                object.geometry.coordinates,
                                                zoom
                                            ).map((v, i) => v - offset[i]),
                                            tileGridSize = Math.max(tileSize / this.__gridSize, 1),
                                            gridNumber = [
                                                Math.min(Math.max(Math.floor(position[0] / this.__gridSize), 0), tileGridSize),
                                                Math.min(Math.max(Math.floor(position[1] / this.__gridSize), 0), tileGridSize)
                                            ];
                                        if (!grid[x][y]) {
                                            grid[x][y] = {};
                                        }
                                        if (!grid[x][y][gridNumber[0]]) {
                                            grid[x][y][gridNumber[0]] = {};
                                        }
                                        if (!grid[x][y][gridNumber[0]][gridNumber[1]]) {
                                            grid[x][y][gridNumber[0]][gridNumber[1]] = [];
                                        }
                                        grid[x][y][gridNumber[0]][gridNumber[1]].push(object);
                                        break;
                                }
                            }
                        }
                    }
                }
            });

            this.__grid = grid;
            window.data = this.__data;
        },

        __getTileRange: function (zoom) {
            var pane = this.getMap().panes.get(this.options.get('pane', 'ground')),
                viewport = pane.getViewport(),
                paneZoom = pane.getZoom(),
                scale = Math.pow(2, zoom - paneZoom),
                tileSize = this.options.get('tileSize', 256),
                pixelBounds = viewport.map((corner) => pane.fromClientPixels(corner).map((coord) => coord * scale));

            return [
                [
                    Math.floor(pixelBounds[0][0] / tileSize),
                    Math.floor(pixelBounds[0][1] / tileSize)
                ], [
                    Math.floor(pixelBounds[1][0] / tileSize),
                    Math.floor(pixelBounds[1][1] / tileSize)
                ]
            ];
        },
        
        __getObjectTileBounds: function (object, projection, zoom) {
            var tileSize = this.options.get('tileSize', 256),
                center = projection.toGlobalPixels(object.geometry.coordinates, zoom),
                size,
                left,
                top,
                right,
                bottom;

            switch (this.__mode) {
                case 'circles':
                    size = Math.round(this.__getObjectRadius(object, zoom));
                    if (size >= 1) {
                        left = center[0] - size;
                        top = center[1] - size;
                        right = center[0] + size;
                        bottom = center[1] + size;
                    }
                    break;
                case 'grid':
                    size = this.__gridSize;
                    left = Math.floor(center[0] / size) * size;
                    top = Math.floor(center[1] / size) * size;
                    right = left + size - 1;
                    bottom = top + size - 1;
                    break;
                default:
                    return null;
            }

            return size >= 1 ? [[
                Math.floor(left / tileSize),
                Math.floor(top / tileSize)
            ], [
                Math.floor(right / tileSize),
                Math.floor(bottom / tileSize)
            ]] : null;
        },

        __renderTile: function (tileNumber, zoom) {
            var map = this.getMap(),
                dpr = utilHd.getPixelRatio(),
                projection = map.options.get('projection'),
                x = tileNumber[0],
                y = tileNumber[1],
                objectIndexes = this.__grid[x] && this.__grid[x][y],
                tileSize = this.options.get('tileSize', 256),
                offset = [
                    x * tileSize,
                    y * tileSize
                ],
                canvas = document.createElement('canvas');
            
            canvas.height = canvas.width = tileSize * dpr;

            if (objectIndexes) {
                var context = canvas.getContext('2d'),
                    defaultFillColor = this.options.get('fillColor', 'rgba(0, 255, 0, 0.8)');

                switch (this.__mode) {
                    case 'circles':
                        objectIndexes.forEach((index) => {
                            var object = this.__data[index],
                                position = projection.toGlobalPixels(
                                    object.geometry.coordinates,
                                    zoom
                                ).map((v, i) => v - offset[i]),
                                radius = Math.round(this.__getObjectRadius(object, zoom)),
                                fillColor = object.options && object.options.fillColor || defaultFillColor;

                            context.fillStyle = fillColor;
                            context.beginPath();
                            context.arc(
                                position[0] * dpr,
                                position[1] * dpr,
                                radius * dpr,
                                0,
                                2 * Math.PI,
                                false
                            );
                            context.closePath();
                            context.fill();
                        });
                        break;
                    case 'grid':
                        Object.keys(objectIndexes).forEach((gridX) => {
                            Object.keys(objectIndexes[gridX]).forEach((gridY) => {
                                var left = gridX * this.__gridSize,
                                    top = gridY * this.__gridSize,

                                    fillColor = this.options.get('fillColor', defaultFillColor);

                                if (typeof fillColor == 'function') {
                                    fillColor = fillColor(objectIndexes[gridX][gridY]);
                                }
                                context.fillStyle = fillColor;

                                if (this.__gridSize >= 8 && this.__gridSize < tileSize) {
                                    context.lineWidth = 1;
                                    context.fillRect(dpr * (left + 2), dpr * (top + 2), dpr * (this.__gridSize - 2), dpr * (this.__gridSize - 2));
                                    context.strokeStyle = '#acb78e';
                                    context.strokeRect(dpr * (left + 1), dpr * (top + 1), dpr * (this.__gridSize - 1), dpr * (this.__gridSize - 1));
                                    context.strokeStyle = '#bebd7f';
                                    context.strokeRect(dpr * left, dpr * top, dpr * (this.__gridSize - 2), dpr * (this.__gridSize - 2));
                                } else {
                                    context.fillRect(dpr * left, dpr * top, dpr * this.__gridSize, dpr * this.__gridSize);
                                }
                            });
                        });
                        //context.fill();
                        break;
                }
            }

            return canvas.toDataURL();
        },

        __contains: function (object, position) {
            var projection = this.getMap().options.get('projection');

            switch (this.__mode) {
                case 'circles':
                    var scale = Math.pow(2, this.__zoom),
                        center = projection.toGlobalPixels(
                            object.geometry.coordinates,
                            this.__zoom
                        ),
                        radius = this.__getObjectRadius(object, this.__zoom),
                        dx = position[0] - center[0],
                        dy = position[1] - center[1];

                    return dx * dx + dy * dy < radius * radius;
                case 'grid':
                    var point = projection.toGlobalPixels(
                            object.geometry.coordinates,
                            this.__zoom
                        ),
                        gridSize = this.__gridSize,
                        gridNumber = [
                            Math.floor(point[0] / gridSize),
                            Math.floor(point[1] / gridSize)
                        ],
                        left = gridNumber[0] * gridSize,
                        top = gridNumber[1] * gridSize;
                    return position[0] >= left && position[0] <= left + gridSize &&
                           position[1] >= top && position[1] <= top + gridSize;
            }
        },

        __getObjectRadius: function (object, zoom) {
            var radius = object.options && object.options.radius || this.options.get('radius');
            if (typeof radius == 'function') {
                radius = radius(object, zoom);
            }
            return radius;
        }
    });

    function rangesDiffer (a, b) {
        return a[0][0] != b[0][0] || a[0][1] != b[0][1] || a[1][0] != b[1][0] || a[1][1] != b[1][1];
    }

    provide(ShapeLayer);
});