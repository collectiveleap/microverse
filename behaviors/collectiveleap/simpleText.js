// Copyright 2022 by Croquet Corporation, Inc. All Rights Reserved.
// https://croquet.io
// info@croquet.io

/*


*/

/*


*/

class SimpleTextActor {
    setup() {
    }
}

class SimpleTextPawn {
    setup() {
	this.someSimpleText();
    }

    /*
      The card that has this module is expected to be "2d" type with textureType: "canvas".
      this.canvas is the DOM canvas element.
      The setColor event at the end informs other related pawns to change their color,
      thus using the view's id as scope.
    */

    someSimpleText() {
        //console.log("changed");
        // this is called on all views, not just the elected one
        let color = "#FF2222";

        this.clear("#222222");
        let ctx = this.canvas.getContext("2d");
        ctx.textAlign = "right";
        ctx.fillStyle = color;

        ctx.font = "40px Arial";
        ctx.fillText("Whole and Parts", this.canvas.width - 40, 85);

        this.texture.needsUpdate = true;
    }

    clear(fill) {
        let ctx = this.canvas.getContext("2d");
        ctx.fillStyle = fill;
        ctx.fillRect( 0, 0, this.canvas.width, this.canvas.height );
    }
}

export default {
    modules: [
        {
            name: "SimpleText",
            actorBehaviors: [SimpleTextActor],
            pawnBehaviors: [SimpleTextPawn],
        }
    ]
}

/* globals Microverse */
