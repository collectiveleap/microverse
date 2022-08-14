// Copyright 2022 by Croquet Corporation, Inc. All Rights Reserved.
// https://croquet.io
// info@croquet.io

/*


*/

/*


*/

class SimpleTextTextActor {
    setup() {
	this.load("hello new world");
    }
}

export default {
    modules: [
        {
            name: "SimpleTextText",
            actorBehaviors: [SimpleTextTextActor],
        }
    ]
}

/* globals Microverse */
