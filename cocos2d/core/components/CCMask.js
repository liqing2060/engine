/****************************************************************************
 Copyright (c) 2013-2016 Chukong Technologies Inc.
 Copyright (c) 2017-2018 Xiamen Yaji Software Co., Ltd.

 http://www.cocos.com

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated engine source code (the "Software"), a limited,
  worldwide, royalty-free, non-assignable, revocable and non-exclusive license
 to use Cocos Creator solely to develop games on your target platforms. You shall
  not use Cocos Creator software for developing other software or tools that's
  used for developing games. You are not granted to publish, distribute,
  sublicense, and/or sell copies of Cocos Creator.

 The software or tools in this License Agreement are licensed, not sold.
 Xiamen Yaji Software Co., Ltd. reserves all rights not expressly granted to you.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/

const misc = require('../utils/misc');
const renderEngine = require('../renderer/render-engine');
const math = renderEngine.math;
const StencilMaterial = renderEngine.StencilMaterial;
const RenderComponent = require('./CCRenderComponent');
const RenderFlow = require('../renderer/render-flow');

let _vec2_temp = cc.v2();
let _mat4_temp = math.mat4.create();

/**
 * !#en the type for mask.
 * !#zh 遮罩组件类型
 * @enum Mask.Type
 */
let MaskType = cc.Enum({
    /**
     * !#en Rect mask.
     * !#zh 使用矩形作为遮罩
     * @property {Number} RECT
     */
    RECT: 0,
    /**
     * !#en Ellipse Mask.
     * !#zh 使用椭圆作为遮罩
     * @property {Number} ELLIPSE
     */
    ELLIPSE: 1,
    /**
     * !#en Image Stencil Mask.
     * !#zh 使用图像模版作为遮罩
     * @property {Number} IMAGE_STENCIL
     */
    IMAGE_STENCIL: 2,
});

const SEGEMENTS_MIN = 3;
const SEGEMENTS_MAX = 10000;

/**
 * !#en The Mask Component
 * !#zh 遮罩组件
 * @class Mask
 * @extends Component
 */
let Mask = cc.Class({
    name: 'cc.Mask',
    extends: RenderComponent,

    editor: CC_EDITOR && {
        menu: 'i18n:MAIN_MENU.component.renderers/Mask',
        help: 'i18n:COMPONENT.help_url.mask',
        inspector: 'packages://inspector/inspectors/comps/mask.js'
    },

    properties: {
        _spriteFrame: {
            default: null,
            type: cc.SpriteFrame
        },

        /**
         * !#en The mask type.
         * !#zh 遮罩类型
         * @property type
         * @type {Mask.Type}
         * @example
         * mask.type = cc.Mask.Type.RECT;
         */
        _type: MaskType.RECT,
        type: {
            get: function () {
                return this._type;
            },
            set: function (value) {
                this._type = value;
                if (this._type !== MaskType.IMAGE_STENCIL) {
                    this.spriteFrame = null;
                    this.alphaThreshold = 0;
                }
                if (this._renderData) {
                    this.destroyRenderData(this._renderData);
                    this._renderData = null;
                }
                this._activateMaterial();
            },
            type: MaskType,
            tooltip: CC_DEV && 'i18n:COMPONENT.mask.type',
        },

        /**
         * !#en The mask image
         * !#zh 遮罩所需要的贴图
         * @property spriteFrame
         * @type {SpriteFrame}
         * @default null
         * @example
         * mask.spriteFrame = newSpriteFrame;
         */
        spriteFrame: {
            type: cc.SpriteFrame,
            tooltip: CC_DEV && 'i18n:COMPONENT.mask.spriteFrame',
            get: function () {
                return this._spriteFrame;
            },
            set: function (value) {
                let lastSprite = this._spriteFrame;
                if (CC_EDITOR) {
                    if ((lastSprite && lastSprite._uuid) === (value && value._uuid)) {
                        return;
                    }
                }
                else {
                    if (lastSprite === value) {
                        return;
                    }
                }
                this._spriteFrame = value;
                this._applySpriteFrame(lastSprite);
            },
        },

        /**
         * !#en
         * The alpha threshold.(Not supported Canvas Mode) <br/>
         * The content is drawn only where the stencil have pixel with alpha greater than the alphaThreshold. <br/>
         * Should be a float between 0 and 1. <br/>
         * This default to 0 (so alpha test is disabled).
         * When it's set to 1, the stencil will discard all pixels, nothing will be shown,
         * In previous version, it act as if the alpha test is disabled, which is incorrect.
         * !#zh
         * Alpha 阈值（不支持 Canvas 模式）<br/>
         * 只有当模板的像素的 alpha 大于 alphaThreshold 时，才会绘制内容。<br/>
         * 该数值 0 ~ 1 之间的浮点数，默认值为 0（因此禁用 alpha 测试）
         * 当被设置为 1 时，会丢弃所有蒙版像素，所以不会显示任何内容，在之前的版本中，设置为 1 等同于 0，这种效果其实是不正确的
         * @property alphaThreshold
         * @type {Number}
         * @default 0
         */
        alphaThreshold: {
            default: 0,
            type: cc.Float,
            range: [0, 1, 0.1],
            slide: true,
            tooltip: CC_DEV && 'i18n:COMPONENT.mask.alphaThreshold',
            notify: function () {
                if (cc.game.renderType === cc.game.RENDER_TYPE_CANVAS) {
                    cc.warnID(4201);
                    return;
                }
                if (this._frontMaterial) {
                    this._frontMaterial.alphaThreshold = this.alphaThreshold;
                    this._endMaterial.alphaThreshold = this.alphaThreshold;
                    this._frontMaterial.updateHash();
                    this._endMaterial._hash = -this._frontMaterial._hash;
                }
            }
        },

        /**
         * !#en Reverse mask (Not supported Canvas Mode)
         * !#zh 反向遮罩（不支持 Canvas 模式）
         * @property inverted
         * @type {Boolean}
         * @default false
         */
        inverted: {
            default: false,
            type: cc.Boolean,
            tooltip: CC_DEV && 'i18n:COMPONENT.mask.inverted',
            notify: function () {
                if (cc.game.renderType === cc.game.RENDER_TYPE_CANVAS) {
                    cc.warnID(4202);
                    return;
                }
            }
        },

        /**
         * TODO: remove segments, not supported by graphics
         * !#en The segements for ellipse mask.
         * !#zh 椭圆遮罩的曲线细分数
         * @property segements
         * @type {Number}
         * @default 64
         */
        _segments: 64,
        segements: {
            get: function () {
                return this._segments;
            },
            set: function (value) {
                this._segments = misc.clampf(value, SEGEMENTS_MIN, SEGEMENTS_MAX);
            },
            tooltip: CC_DEV && 'i18n:COMPONENT.mask.segements',
        },

        _resizeToTarget: {
            animatable: false,
            set: function (value) {
                if(value) {
                    this._resizeNodeToTargetNode();
                }
            }
        }
    },

    statics: {
        Type: MaskType,
    },

    _resizeNodeToTargetNode: CC_EDITOR && function () {
        if(this.spriteFrame) {
            let rect = this.spriteFrame.getRect();
            this.node.setContentSize(rect.width, rect.height);
        }
    },

    _onTextureLoaded: function (event) {
        // Mark render data dirty
        if (this._renderData) {
            this._renderData.uvDirty = true;
            this._renderData.vertDirty = true;
            this.markForUpdateRenderData(true);
        }
        // Reactivate material
        if (this.enabledInHierarchy) {
            this._activateMaterial();
        }
    },

    _applySpriteFrame: function (oldFrame) {
        if (oldFrame && oldFrame.off) {
            oldFrame.off('load', this._onTextureLoaded, this);
        }
        let spriteFrame = this._spriteFrame;
        if (spriteFrame) {
            if (spriteFrame.textureLoaded()) {
                this._onTextureLoaded(null);
            }
            else {
                spriteFrame.once('load', this._onTextureLoaded, this);
                spriteFrame.ensureLoadTexture();
            }
        }
    },

    _activateMaterial: function () {
        // cannot be activated if texture not loaded yet
        if (this._type === MaskType.IMAGE_STENCIL && (!this.spriteFrame || !this.spriteFrame.textureLoaded())) {
            this.markForRender(false);
            return;
        }

        // WebGL
        if (cc.game.renderType !== cc.game.RENDER_TYPE_CANVAS) {
            // Init material
            if (!this._frontMaterial) {
                this._frontMaterial = new StencilMaterial();
                this._endMaterial = new StencilMaterial();
            }

            // Reset material
            if (this._type === MaskType.IMAGE_STENCIL) {
                let texture = this.spriteFrame.getTexture();
                this._frontMaterial.useTexture = true;
                this._frontMaterial.useColor = true;
                this._frontMaterial.texture = texture;
                this._frontMaterial.alphaThreshold = this.alphaThreshold;
                this._endMaterial.useTexture = true;
                this._endMaterial.useColor = true;
                this._endMaterial.texture = texture;
                this._endMaterial.alphaThreshold = this.alphaThreshold;
            }
            else {
                this._frontMaterial.useTexture = false;
                this._frontMaterial.useColor = false;
                this._endMaterial.useTexture = false;
                this._endMaterial.useColor = false;
            }
            
            if (!this._material) {
                this._updateMaterial(this._frontMaterial);
            }

            // Avoid next up mask material to be batch with the exit one
            this._endMaterial._hash = -this._frontMaterial._hash;
        }

        this.markForRender(true);
    },

    _hitTest: function (cameraPt) {
        let node = this.node;
        let size = node.getContentSize(),
            w = size.width,
            h = size.height,
            testPt = _vec2_temp;
        
        node._updateWorldMatrix();
        math.mat4.invert(_mat4_temp, node._worldMatrix);
        math.vec2.transformMat4(testPt, cameraPt, _mat4_temp);
        testPt.x += node._anchorPoint.x * w;
        testPt.y += node._anchorPoint.y * h;

        if (this.type === MaskType.RECT || this.type === MaskType.IMAGE_STENCIL) {
            return testPt.x >= 0 && testPt.y >= 0 && testPt.x <= w && testPt.y <= h;
        }
        else if (this.type === MaskType.ELLIPSE) {
            let rx = w / 2, ry = h / 2;
            let px = testPt.x - 0.5 * w, py = testPt.y - 0.5 * h;
            return px * px / (rx * rx) + py * py / (ry * ry) < 1;
        }
    },

    markForUpdateRenderData (enable) {
        if (enable && this.enabledInHierarchy) {
            this.node._renderFlag |= RenderFlow.FLAG_UPDATE_RENDER_DATA | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA;
        }
        else if (!enable) {
            this.node._renderFlag &= ~(RenderFlow.FLAG_UPDATE_RENDER_DATA | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA);
        }
    },

    markForRender (enable) {
        if (enable && this.enabledInHierarchy) {
            this.node._renderFlag |= (RenderFlow.FLAG_RENDER | RenderFlow.FLAG_UPDATE_RENDER_DATA | 
                                      RenderFlow.FLAG_POST_RENDER | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA);
        }
        else if (!enable) {
            this.node._renderFlag &= ~(RenderFlow.FLAG_RENDER | RenderFlow.FLAG_POST_RENDER);
        }
    },

    disableRender () {
        this.node._renderFlag &= ~(RenderFlow.FLAG_RENDER | RenderFlow.FLAG_UPDATE_RENDER_DATA | 
                                   RenderFlow.FLAG_POST_RENDER | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA);
    },

    onEnable () {
        this._super();
        // for graphic stencil data
        this._graphics = null;

        if (!this._spriteFrame || !this._spriteFrame.textureLoaded()) {
            // Do not render when sprite frame is not ready
            if (this._spriteFrame) {
                this._spriteFrame.once('load', this._onTextureLoaded, this);
                this._spriteFrame.ensureLoadTexture();
            }
        }

        this.node._renderFlag |= RenderFlow.FLAG_POST_RENDER | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA;
        this._activateMaterial();
    },

    onDisable () {
        this._super();
        this.node._renderFlag &= ~(RenderFlow.FLAG_POST_RENDER | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA);
    },

    onDestroy () {
        this._super();
        this._frontMaterial = null;
        this._endMaterial = null;
    },
});

cc.Mask = module.exports = Mask;
