/****************************************************************************
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

const StencilManager = require('../stencil-manager');
const Node = require('../../../CCNode');
const Mask = require('../../../components/CCMask');
const RenderFlow = require('../../render-flow');

const spriteAssembler = require('./sprite/simple');
const Graphics = require('../../../graphics/graphics');
const graphicsAssembler = require('./graphics');

let _stencilMgr = StencilManager.sharedManager;
// for nested mask, we might need multiple graphics component to avoid data conflict
let _graphicsPool = [];

function getGraphics () {
    let graphics = _graphicsPool.pop();

    if (!graphics) {
        let graphicsNode = new Node();
        graphics = graphicsNode.addComponent(Graphics);
        graphics.lineWidth = 0;
    }
    return graphics;
}

let maskFrontAssembler = {
    updateGraphics (mask) {
        let renderData = mask._renderData;
        let graphics = mask._graphics;
        // Share render data with graphics content
        graphics.clear(false);
        let width = renderData._width;
        let height = renderData._height;
        let x = -width * renderData._pivotX;
        let y = -height * renderData._pivotY;
        if (mask._type === Mask.Type.RECT) {
            graphics.rect(x, y, width, height);
        }
        else if (mask._type === Mask.Type.ELLIPSE) {
            let cx = x + width / 2,
                cy = y + height / 2,
                rx = width / 2,
                ry = height / 2;
            graphics.ellipse(cx, cy, rx, ry);
        }
        graphics.fill();
    },

    updateRenderData (mask) {
        if (!mask._renderData) {
            if (mask._type === Mask.Type.IMAGE_STENCIL) {
                mask._renderData = spriteAssembler.createData(mask);
            }
            else {
                // for updateGraphics calculation
                mask._renderData = mask.requestRenderData();
            }
        }
        let renderData = mask._renderData;
        let size = mask.node._contentSize;
        let anchor = mask.node._anchorPoint;
        renderData.updateSizeNPivot(size.width, size.height, anchor.x, anchor.y);

        mask._material = mask._frontMaterial;
        if (mask._type === Mask.Type.IMAGE_STENCIL) {
            if (mask._material && mask.spriteFrame) {
                mask._material.useModel = false;
                renderData.dataLength = 4;
                spriteAssembler.updateRenderData(mask);
                renderData.material = mask.getMaterial();
            }
            else {
                mask._material = null;
            }
        }
        else {
            mask._material.useModel = true;
            mask._graphics = getGraphics();
            this.updateGraphics(mask);
            mask._graphics._material = mask._material;
            graphicsAssembler.updateRenderData(mask._graphics);
        }
    },

    fillBuffers (mask, renderer) {
        // Invalid state
        if (mask._type !== Mask.Type.IMAGE_STENCIL || mask.spriteFrame) {
            // HACK: Must push mask after batch, so we can only put this logic in fillVertexBuffer or fillIndexBuffer
            _stencilMgr.pushMask(mask);

            // vertex buffer
            if (mask._type === Mask.Type.IMAGE_STENCIL) {
                spriteAssembler.fillBuffers(mask, renderer);
            }
            else {
                // Share node for correct global matrix
                mask._graphics.node = mask.node;
                graphicsAssembler.fillBuffers(mask._graphics, renderer);
            }
        }

        mask.node._renderFlag |= RenderFlow.FLAG_UPDATE_RENDER_DATA;
    }
};

let maskEndAssembler = {
    updateRenderData (mask) {
        if (mask._type === Mask.Type.IMAGE_STENCIL && !mask.spriteFrame) {
            mask._material = null;
        }
        else {
            mask._material = mask._endMaterial;
        }
        let material = mask._material;

        if (!material) {
            return;
        }
        if (mask._type === Mask.Type.IMAGE_STENCIL) {
            material.useModel = false;
            let data = mask._renderData;
            data.material = material;
        }
        else {
            material.useModel = true;
            let datas = mask._graphics._impl._renderDatas;
            for (let i = 0; i < datas.length; i++) {
                datas[i].material = material;
            }
        }
    },

    fillBuffers (mask, renderer) {
        // Invalid state
        if (mask._type !== Mask.Type.IMAGE_STENCIL || mask.spriteFrame) {
            // HACK: Must pop mask after batch, so we can only put this logic in fillBuffers
            _stencilMgr.popMask();

            // vertex buffer
            if (mask._type === Mask.Type.IMAGE_STENCIL) {
                spriteAssembler.fillBuffers(mask, renderer);
            }
            else {
                // Share node for correct global matrix
                mask._graphics.node = mask.node;
                graphicsAssembler.fillBuffers(mask._graphics, renderer);
                // put back graphics to pool
                _graphicsPool.push(mask._graphics);
                mask._graphics = null;
            }
        }

        mask.node._renderFlag |= RenderFlow.FLAG_UPDATE_RENDER_DATA | RenderFlow.FLAG_POST_UPDATE_RENDER_DATA;
    }
};

Mask._assembler = maskFrontAssembler;
Mask._postAssembler = maskEndAssembler;

module.exports = {
    front: maskFrontAssembler,
    end: maskEndAssembler
}