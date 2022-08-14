class CounterButtonActor { // Buttons adjust counter
    setup() {
		console.log("CounterButtonActor::setup 1");
        this.occupier = undefined;
        this.listen("publishMove", "publishMove");
        this.listen("pressButton", "pressButton");
        this.listen("publishFocus", "publishFocus");
        this.subscribe(this._cardData.myScope, "focus", "focus");
    }

    // Publish Translation
    publishMove() {
		console.log("CounterButtonActor::publishMove");
		this.publish("counter", "reset");
        if (this.occupier !== undefined) { this.future(60).publishMove(); }
        //this.publish("crane", "updatePositionBy", this._cardData.craneSpeed);
    }

    // Update Translation
    pressButton(data) {
		console.log("CounterButtonActor::pressButton");
        let {translation, color} = data;
        this.translateTo(translation);
        this.say("updateColor", color);
    }

    // Publish New Focus
    publishFocus(viewId) {
		console.log("CounterButtonActor::publishFocus");
        this.publish(this._cardData.myScope, "focus", viewId);
    }  

    // Focus Controlling Player
    focus(viewId) {
		console.log("CounterButtonActor::focus");
        this.occupier = viewId;
    }
}

class CounterButtonPawn {
    setup() {
		console.log("CounterButtonPawn::setup 1");
        this.shape.children.forEach((c) => this.shape.remove(c));
        this.shape.children = [];

        if (this.shape.children.length === 0) {

            let shape = new Microverse.THREE.Shape();
            shape.moveTo(0, 0);
            shape.lineTo(-0.08, 0); // Start of First Curve
            shape.quadraticCurveTo(-0.1, 0, -0.1, 0.025); // End of First Curve
            shape.lineTo(-0.1, 0.2);
            shape.quadraticCurveTo(-0.1, 0.25, -0.125, 0.25);
            shape.lineTo(-0.15, 0.25);
            shape.quadraticCurveTo(-0.25, 0.25, -0.15, 0.35);
            shape.lineTo(-0.05, 0.45);
            shape.quadraticCurveTo(0, 0.5, 0.05, 0.45);
            shape.lineTo(0.15, 0.35);
            shape.quadraticCurveTo(0.25, 0.25, 0.15, 0.25);
            shape.lineTo(0.125, 0.25);
            shape.quadraticCurveTo(0.1, 0.25, 0.1, 0.2);
            shape.lineTo(0.1, 0.025);
            shape.quadraticCurveTo(0.1, 0, 0.08, 0); 
            shape.lineTo(0, 0);

            let extrudeSettings = {
                bevelEnabled: true,
                bevelThickness: 0,
                bevelSize: 0,
                bevelOffset: 0,
                bevelSegments: 0,
                depth: 0.15,
                steps: 5,
            }

            let geometry = new Microverse.THREE.ExtrudeGeometry(shape, extrudeSettings);
            let material = new Microverse.THREE.MeshStandardMaterial({color: this.actor._cardData.color || 0xD86508});
            this.obj = new Microverse.THREE.Mesh(geometry, material);
            this.obj.castShadow = this.actor._cardData.shadow;
            this.obj.receiveShadow = this.actor._cardData.shadow;
            this.shape.add(this.obj);
        }

        this.addEventListener("pointerDown", "start");
        this.addEventListener("pointerUp", "stop");
        this.listen("updateColor", "updateColor");

        this.upTranslation = this.actor._translation; // Storing Current and Pressed Translations (Avoids Errors)
        this.downTranslation = [this.actor._translation[0], this.actor._translation[1], this.actor._translation[2] - 0.1];
    }

    start() {
		console.log("CounterButtonPawn::start");
        if (this.actor.occupier === undefined) {
            this.say("pressButton", {translation: this.downTranslation, color: 0x313333});
            this.say("publishFocus", this.viewId);
            this.say("publishMove");
        }
    }

    stop() {
		console.log("CounterButtonPawn::stop");
        if (this.actor.occupier === this.viewId) {
            this.say("pressButton", {translation: this.upTranslation, color: 0xD86508});
            this.say("publishFocus", undefined);
        }
    }

    updateColor(color) {
        this.obj.material.color.set(color);
    }
}

/* one behavior module is exported from this file. */

export default {
    modules: [
        {
            name: "CounterButton",
            actorBehaviors: [CounterButtonActor],
            pawnBehaviors: [CounterButtonPawn]
        }
    ]
}

/* globals Microverse */
