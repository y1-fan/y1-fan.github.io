function addLoadEvent(func) {
    var oldonload = window.onload;
    if (typeof window.onload != 'function') {
        window.onload = func;
    } else {
        window.onload = function() {
            oldonload();
            func();
        }
    }
}

addLoadEvent(function() {
    console.log('tag cloud plugin rock and roll!');

    try {
        TagCanvas.textFont = 'Helvetica';
        TagCanvas.textColour = '#a09ea2';
        TagCanvas.textHeight = 35;
        TagCanvas.outlineColour = '#a09ea2';
        TagCanvas.maxSpeed = 0.03;
        TagCanvas.freezeActive = true;
        TagCanvas.outlineMethod = 'border';
        TagCanvas.minBrightness = 0.2;
        TagCanvas.depth = 0.92;
        TagCanvas.pulsateTo = 0.6;
        TagCanvas.initial = [0.2,-0.1];
        TagCanvas.decel = 0.98;
        TagCanvas.reverse = true;
        TagCanvas.hideTags = false;
        TagCanvas.shadow = false;
        TagCanvas.shadowBlur = false;
        TagCanvas.weight = false;
        TagCanvas.imageScale = null;
        TagCanvas.fadeIn = false;
        TagCanvas.clickToFront = 600;
        TagCanvas.lock = false;
        TagCanvas.Start('resCanvas');
        TagCanvas.tc['resCanvas'].Wheel(true);

    } catch(e) {
        console.log(e);
        document.getElementById('myCanvasContainer').style.display = 'none';
    }
});
