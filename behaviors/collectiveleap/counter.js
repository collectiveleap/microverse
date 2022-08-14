/*


*/

/*


*/

class CounterActor {
	setup() {
		this.n = 0;
		this.subscribe("counter", "set", this.set);
		this.future(100).tick();

		//this.load("hello new world");
    }

	set(value) {
		this.n = value;
		this.say("counterChanged");
	}

	tick() {
		this.set(this.n + 0.1);
		this.future(100).tick();
	}
}

class CounterPawn {
	setup() {
		this.listen("counterChanged", "changed");
		this.changed();
	}

    /*
      The card that has this module is expected to be "2d" type with textureType: "canvas".
      this.canvas is the DOM canvas element.
      The setColor event at the end informs other related pawns to change their color,
      thus using the view's id as scope.
    */

    changed() {
        //console.log("changed");
        // this is called on all views, not just the elected one
        let color = "#FF2222";

        this.clear("#222222");
        let ctx = this.canvas.getContext("2d");
        ctx.textAlign = "right";
        ctx.fillStyle = color;

        ctx.font = "40px Arial";
        ctx.fillText("Counter " + this.actor.n.toFixed(1), this.canvas.width - 40, 85);

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
            name: "Counter",
            actorBehaviors: [CounterActor],
            pawnBehaviors: [CounterPawn],
        }
    ]
}

/* globals Microverse */
