// Copyright 2022 by Croquet Corporation, Inc. All Rights Reserved.
// https://croquet.io
// info@croquet.io

import {
    THREE, Data, App, mix, GetPawn, AM_Player, PM_Player, PM_SmoothedDriver, PM_ThreeCamera, PM_ThreeVisible,
    v3_isZero, v3_add, v3_sub, v3_scale, v3_sqrMag, v3_normalize, v3_rotate, v3_multiply, v3_lerp, v3_transform,
    q_isZero, q_normalize, q_pitch, q_yaw, q_roll, q_identity, q_euler, q_axisAngle, q_slerp, q_multiply,
    m4_multiply, m4_rotationQ, m4_translation, m4_invert, m4_getTranslation, m4_getRotation} from "@croquet/worldcore";

import { isPrimaryFrame, addShellListener, removeShellListener, sendToShell } from "./frame.js";
import {PM_Pointer} from "./Pointer.js";
import {CardActor, CardPawn} from "./DCard.js";

import {setupWorldMenuButton} from "./worldMenu.js";

let EYE_HEIGHT = 1.676;
let EYE_EPSILON = 0.01;
let THROTTLE = 50;
let PORTAL_DISTANCE = 1;
let isMobile = !!("ontouchstart" in window);

export class AvatarActor extends mix(CardActor).with(AM_Player) {
    init(options) {
        let playerId = options.playerId;
        delete options.playerId;
        super.init(options);
        this._playerId = playerId;
        this._layers = ["avatar"];

        this.fall = false;
        this.tug = 0.05; // minimize effect of unstable wifi
        this.set({tickStep: 30});
        this.listen("goHome", this.goHome);
        this.listen("goThere", this.goThere);
        this.listen("startMMotion", this.startFalling);
        this.listen("setFloor", this.setFloor);
        this.listen("avatarLookTo", this.onLookTo);
        this.listen("comeToMe", this.comeToMe);
        this.listen("followMeToWorld", this.followMeToWorld);
        this.listen("stopPresentation", this.stopPresentation);
        this.listen("inWorldSet", this.inWorldSet);
        this.listen("fileUploaded", "fileUploaded");
        this.listen("addSticky", this.addSticky);
        this.listen("resetHeight", this.resetHeight);
        this.subscribe("playerManager", "presentationStarted", this.presentationStarted);
        this.subscribe("playerManager", "presentationStopped", this.presentationStopped);
    }

    get pawn() { return AvatarPawn; }
    get lookPitch() { return this._lookPitch || 0; }
    get lookYaw() { return this._lookYaw || 0; }
    get lookOffset() { return this._lookOffset || 0; }
    get lookNormal() { return v3_rotate([0,0,-1], this.rotation); }
    get collisionRadius() { return this._collisionRadius || 0.375; }
    get inWorld() { return !!this._inWorld; }   // our user is either in this world or render

    leavePresentation() {
        if (!this.follow) {return;}
        let manager = this.service("PlayerManager");
        let presentationMode = manager.presentationMode;
        if (!presentationMode) {return;}
        if (this.follow !== this.playerId) {
            this.presentationStopped();
            this.say("setLookAngles", {lookOffset: [0, 0, 0]});
            manager.leavePresentation(this.playerId);
        }
    }

    stopPresentation() {
        this.service("PlayerManager").stopPresentation();
    }

    inWorldSet({o, v}) {
        if (!o !== !v) this.service("PlayerManager").playerInWorldChanged(this);
    }

    setFloor(p) {
        let t = this.translation;
        this.translation = [t[0], p, t[2]];
    }

    startFalling() {
        this.fall = true;
    }

    resetHeight() {
        let t = this.translation;
        this.goTo([t[0], 0, t[2]], this.rotation, false);
    }

    onLookTo(e) {
        let [pitch, yaw, lookOffset] = e;
        this.set({lookPitch: pitch, lookYaw: yaw});
        this.rotateTo(q_euler(0, this.lookYaw, 0));
        if (typeof lookOffset!=='undefined') this._lookOffset = lookOffset;
        this.restoreTargetId = undefined; // if you look around, you can't jump back
    }

    goHome() {
        let [v, q] = [[0,0,0], [0,0,0,1]];
        this.goTo(v, q, false);
        this.say("setLookAngles", {pitch: 0, yaw: 0, lookOffset: [0, 0, 0]});
        this.set({lookPitch: 0, lookYaw: 0});
        this._lookOffset = [0,0,0];
    }

    goTo(v, q, fall) {
        this.leavePresentation();
        this.vStart = [...this.translation];
        this.qStart = [...this.rotation];
        this.vEnd = v;
        this.qEnd = q;
        this.fall = fall;
        this.goToStep(0.1);
        //this.set({translation: there[0], rotation: there[1]});
    }

    goThere(p3d) {
        this.leavePresentation();
        this.vStart = [...this.translation];
        this.qStart = [...this.rotation];

        if (!this.fall && (p3d.targetId === this.restoreTargetId)) { // jumpback if you are  doubleclicking on the same target you did before
            this.vEnd = this.restoreTranslation;
            this.qEnd = this.restoreRotation;
            this.restoreRotation = undefined;
            this.restoreTranslation = undefined;
            this.restoreTargetId = undefined;
        } else {
            this.fall = false; // sticky until we move
            this.restoreRotation = [...this.rotation];
            this.restoreTranslation = [...this.translation];
            this.restoreTargetId = p3d.targetId;
            let normal = [...(p3d.normal || this.lookNormal)]; //target normal may not exist
            let point = p3d.xyz;
            this.vEnd = v3_add(point, v3_scale(normal, p3d.offset || EYE_HEIGHT));
            normal[1] = 0; // clear up and down
            let nsq = v3_sqrMag(normal);
            if (nsq < 0.0001) {
                this.qEnd = this.rotation; // use the current rotation
            }else {
                normal = v3_normalize(normal);
                let theta = Math.atan2(normal[0], normal[2]);
                this.qEnd = q_euler(0, theta, 0);
            }
            if (p3d.look) {
                let pitch = q_pitch(this.qEnd);
                let yaw = q_yaw(this.qEnd);
                this.set({lookPitch: pitch, lookYaw: yaw});
                this.say("setLookAngles", {pitch, yaw});
            }
        }
        this.goToStep(0.1);
    }

    comeToMe() {
        this.norm = this.lookNormal;
        this.service("PlayerManager").startPresentation(this.playerId);
    }

    followMeToWorld(portalURL) {
        const manager = this.service("PlayerManager");
        if (manager.presentationMode === this.playerId) {
            for (const playerId of manager.followers) {
                const follower = manager.player(playerId);
                follower.leaveToWorld(portalURL);
            }
        }
    }

    leaveToWorld(portalURL) {
        this.say("leaveToWorld", portalURL);
    }

    presentationStarted(playerId) {
        if (this.playerId !== playerId && this.inWorld) {
            let leader = this.service("PlayerManager").player(playerId);
            this.goTo(leader.translation, leader.rotation, false);
            this.follow = playerId;
            this.fall = false;
        }
    }

    presentationStopped() {
        this.follow = null;
    }

    goToStep(delta, t) {
        if (!t) t = delta;
        if (t >= 1) t = 1;
        let v = v3_lerp(this.vStart, this.vEnd, t);
        let q = q_slerp(this.qStart, this.qEnd, t);
        this.set({translation: v, rotation: q});
        this.say("forceOnPosition");
        if (t < 1) this.future(50).goToStep(delta, t + delta);
    }

    tick(delta) {
        if (this.follow) {
            let followMe = this.service("PlayerManager").players.get(this.follow);
            if (followMe) {
                this.positionTo({v:followMe.translation, q:followMe.rotation});
                this._lookYaw = followMe.lookYaw;
                this._lookPitch = followMe.lookPitch;
                this._lookOffset = followMe.lookOffset;
                //this.moveTo(followMe.translation);
                //this.rotateTo(followMe.rotation);
                //this.say("setLookAngles", { pitch: followMe.lookPitch, lookOffset: followMe.lookOffset});//yaw: followMe.lookYaw,
                this.say("forceFollow");
            } else {
                this.presentationStopped();
            }
        }
        if (!this.doomed) this.future(this.tickStep).tick(this.tickStep);
       // super.tick(delta);
    }

    dropPose(distance, optOffset) {
        // compute the position in front of the avatar
        // optOffset is perpendicular (on the same xz plane) to the lookNormal

        let n = this.lookNormal;
        let t = this.translation;
        let r = this.rotation;
        if (!optOffset) {
            let p = v3_add(v3_scale(n, distance), t);
            return {translation: p, rotation: r};
        }

        let q = q_euler(0, -Math.PI / 2, 0);
        let perpendicular = v3_rotate(n, q);
        let offset = v3_multiply(optOffset, perpendicular);
        let p = v3_add(v3_add(v3_scale(n, distance), t), offset);
        return {translation:p, rotation:r};
    }

    fileUploaded(data) {
        let {dataId, fileName, type, translation, rotation} = data;
        let appManager = this.service("DynaverseAppManager");
        let CA = appManager.get("CardActor");

        let cardType = type === "exr" ? "lighting" : (type === "svg" || type === "img" ? "2d" : "3d");

        let options = {
            name: fileName,
            translation,
            rotation,
            type: cardType,
            fileName,
            modelType: type,
            shadow: true,
            singleSided: true
        };

        if (type === "img") {
            options = {
                ...options,
                textureLocation: dataId,
                textureType: "image",
                scale: [4, 4, 4],
                cornerRadius: 0.02,
                fullBright: false,
            };
        } else {
            options = {...options, dataLocation: dataId};
        }

        if (type !== "exr") {
            CA.load([{card: options}], this.wellKnownModel("ModelRoot"), "1")[0];
        } else {
            let light = [...this.service("ActorManager").actors.values()].find(o => o._cardData.type === "lighting");
            if (light) {
                light.updateOptions({...light._cardData, dataLocation: dataId, dataType: "exr"});
            }
        }

        this.publish(this.sessionId, "triggerPersist");
    }

    addSticky(pe) {
        const tackOffset = 0.1;
        let tackPoint = v3_add(pe.xyz, v3_scale(pe.normal, tackOffset));
        let normal = [...pe.normal]; // clear up and down
        normal[1] = 0;
        let nsq = v3_sqrMag(normal);
        let rotPoint;
        if (nsq > 0.0001) {
            normal = v3_normalize(normal);
            let theta = Math.atan2(normal[0], normal[2]);
            rotPoint = q_euler(0, theta, 0);
        } else {
            rotPoint = this.rotation;
            tackPoint[1] += 2;
        }

        let appManager = this.service("DynaverseAppManager");
        let CA = appManager.get("CardActor");

        let options = {
            name:'sticky note',
            className: "TextFieldActor",
            behaviorModules: ["StickyNote"],
            translation: tackPoint,
            rotation: rotPoint,
            type: "text",
            depth: 0.05,
            margins: {left: 20, top: 20, right: 20, bottom: 20},
            backgroundColor: 0xf4e056,
            frameColor: 0xfad912,
            runs: [],
            width: 1,
            height: 1,
            textScale: 0.002
        };

        CA.load([{card: options}], this.wellKnownModel("ModelRoot"), "1")[0];
        this.publish(this.sessionId, "triggerPersist");
    }
}

AvatarActor.register('AvatarActor');

export class AvatarPawn extends mix(CardPawn).with(PM_Player, PM_SmoothedDriver, PM_ThreeVisible, PM_ThreeCamera, PM_Pointer) {
    get spin() {return this._spin || q_identity()}
    set spin(s){this._spin = s;}
    get velocity() {return this._velocity|| v3_zero() }
    set velocity(v){this._velocity = v;}

    constructor(actor) {
        super(actor);
        this.lastUpdateTime = 0;
        this.lastTranslation = this.actor.translation;
        this.opacity = 1;

        this.lookPitch = this.actor.lookPitch;
        this.lookYaw = this.actor.lookYaw;
        this._rotation = q_euler(0, this.lookYaw, 0);
        this.lookOffset = [0, 0, 0]; // Vector displacing the camera from the avatar origin.
        if (this.isMyPlayerPawn) {
            let renderMgr = this.service("ThreeRenderManager");
            this.camera = renderMgr.camera;
            this.scene = renderMgr.scene;
            this.lastHeight = EYE_HEIGHT; // tracking the height above ground
            this.yawDirection = -1; // which way the mouse moves the world depends on if we are using WASD or not

            this.walkCamera = new THREE.Object3D();

            this.walkcaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, - 1, 0));
            this.portalcaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(), 0, PORTAL_DISTANCE);

            this.future(100).fadeNearby();
            this.lastTranslation = this.translation;

            // clip halfspace behind portalCamera
            this.portalClip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

            document.getElementById("homeBttn").onclick = () => this.goHome();
            document.getElementById("usersComeHereBttn").onclick = () => this.comeToMe();
            document.getElementById("editModeBttn").setAttribute("mobile", isMobile);
            document.getElementById("editModeBttn").setAttribute("pressed", false);

            let editButton = document.getElementById("editModeBttn");
            editButton.onpointerdown = (evt) => this.setEditMode(evt);
            editButton.onpointerup = (evt) => this.clearEditMode(evt);

            setupWorldMenuButton(this, App, this.sessionId);

            this.assetManager = this.service("AssetManager");
            window.assetManager = this.assetManager.assetManager;

            this.assetManager.assetManager.setupHandlersOn(window, (buffer, fileName, type) => {
                return Data.store(this.sessionId, buffer, true).then((handle) => {
                    let dataId = Data.toId(handle);
                    let pose = this.dropPose(6);
                    this.say("fileUploaded", {
                        dataId, fileName, type: /^(jpe?g|png|gif)$/.test(type) ? "img" : type,
                        translation: pose.translation,
                        rotation: pose.rotation
                    });
                });
            });

            // keep track of being in the primary frame or not
            this.isPrimary = isPrimaryFrame;
            this.say("_set", { inWorld: this.isPrimary });
            this.shellListener = (command, { frameType, spec, cameraMatrix, dx, dy}) => {
                switch (command) {
                    case "frame-type":
                        const isPrimary = frameType === "primary";
                        if (isPrimary !== this.isPrimary) {
                            this.frameTypeChanged(isPrimary, spec);
                            this.isPrimary = isPrimary;
                        }
                        // tell shell that we received this command (TODO: should only send this once)
                        sendToShell("started");
                        break;
                    case "portal-update":
                        if (!this.actor.inWorld) {
                            if (cameraMatrix) {
                                this.portalLook = cameraMatrix;
                                this.refreshCameraTransform();
                            }
                        }
                        break;
                    case "motion-start":
                        this.startMMotion();
                        if (dx || dy) this.updateMMotion(dx, dy);
                        break;
                    case "motion-end":
                        this.endMMotion();
                        break;
                    case "motion-update":
                        this.updateMMotion(dx, dy);
                        break;
                }
            }
            addShellListener(this.shellListener);
            this.say("resetHeight");
            this.subscribe("playerManager", "playerCountChanged", this.showNumbers);
            this.listen("setLookAngles", this.setLookAngles);
            this.listen("leaveToWorld", this.leaveToWorld);
            this.showNumbers();

            /*

            this.addFirstResponder("pointerTap", {ctrlKey: true}, this);
            this.addEventListener("pointerTap", this.pointerTap);

            this.addFirstResponder("pointerDown", {ctrlKey: true}, this);
            this.addLastResponder("pointerDown", {}, this);
            this.addEventListener("pointerDown", this.pointerDown);

            this.addFirstResponder("pointerMove", {ctrlKey: true}, this);
            this.addLastResponder("pointerMove", {}, this);
            this.addEventListener("pointerMove", this.pointerMove);

            this.addLastResponder("pointerUp", {ctrlKey: true}, this);
            this.addEventListener("pointerUp", this.pointerUp);

            this.addLastResponder("pointerWheel", {}, this);
            this.addEventListener("pointerWheel", this.pointerWheel);

            this.removeEventListener("pointerDoubleDown", "onPointerDoubleDown");
            this.addFirstResponder("pointerDoubleDown", {shiftKey: true}, this);
            this.addEventListener("pointerDoubleDown", this.addSticky);

            this.addLastResponder("keyDown", {}, this);
            this.addEventListener("keyDown", this.keyDown);

            this.addLastResponder("keyUp", {}, this);
            this.addEventListener("keyUp", this.keyUp);

            */
           //this.listenOnce("forceScaleSet", this.onScale);
            this.listen("forceFollow", this.forceFollow);
            this.listen("forceOnPosition", this.onPosition);

            this.listen("goThere", this.stopFalling);
            console.log("MyPlayerPawn created", this, "primary:", this.isPrimary);

            this.wasdVelocity = [0, 0, 0];
            this.wasdMap = {w: false, a: false, d: false, s: false};
        }
    }

    get presenting() {
        return this.actor.service("PlayerManager").presentationMode === this.viewId;
    }

    onPosition(){
        super.onPosition();
        if (!this._global) {
            this.say("viewGlobalChanged");
            if (this.children) this.children.forEach(child => child.onGlobalChanged()); // If our global changes, so do the globals of our children
        }        
    }
    setLookAngles(data) {
        let {pitch, yaw, lookOffset} = data;
        this.lookTo(pitch, yaw, lookOffset);
    }

    dropPose(distance, optOffset) { // compute the position in front of the avatar
        return this.actor.dropPose(distance, optOffset);
    }

    showNumbers() {
        let manager = this.actor.service("PlayerManager");
        let comeHere = document.getElementById("usersComeHereBttn");
        let userCountReadOut = comeHere.querySelector("#userCountReadOut");
        if (userCountReadOut) {
            // TODO: change PlayerManager to only create avatars for players that are actually in the world
            let total = manager.players.size;
            let here = manager.playersInWorld().length;
            let tooltip = `${here} ${here === 1 ? "user is" : "users are"} in this world`;
            if (here !== total) {
                let watching = total - here;
                tooltip += `, ${watching} ${watching === 1 ? "user has" : "users have"} not entered yet`;
                total = `${here}+${watching}`;
            }
            if (manager.presentationMode) {
                let followers = manager.followers.size;
                userCountReadOut.textContent = `${followers}/${total}`;
                tooltip = `${followers} ${followers === 1 ? "user" : "users"} in guided tour, ${tooltip}`;
            } else {
                userCountReadOut.textContent = `${total}`;
            }
            comeHere.setAttribute("title", tooltip);
        }

        comeHere.setAttribute("presenting", this.presenting);
    }

    setEditMode(evt) {
        evt.target.setAttribute("pressed", true);
        evt.target.setPointerCapture(evt.pointerId);
        evt.stopPropagation();
        this.service("InputManager").setModifierKeys({ctrlKey: true});
    }

    clearEditMode(evt) {
        evt.target.setAttribute("pressed", false);
        evt.target.releasePointerCapture(evt.pointerId);
        evt.stopPropagation();
        this.service("InputManager").setModifierKeys({ctrlKey: false});
    }

    lookTo(pitch, yaw, lookOffset) {
        if (typeof pitch !== 'undefined') {this.lookPitch = pitch;}
        if (typeof yaw !== 'undefined') {this.lookYaw = yaw;}
        if(typeof lookOffset!== 'undefined') {this.lookOffset = lookOffset;}
        this.lastLookTime = this.time;
        this.lastLookCache = null;
        let q = q_euler(0, this.lookYaw, 0);
        this.rotateTo(q);
        this.say("avatarLookTo", [pitch, yaw, lookOffset]);
        if (!this._global) {
            this.say("viewGlobalChanged");
            if (this.children) this.children.forEach(child => child.onGlobalChanged()); // If our global changes, so do the globals of our children
        }
    }

    destroy() {
        removeShellListener(this.shellListener);
        // When the pawn is destroyed, we dispose of our Three.js objects.
        // the avatar memory will be reclaimed when the scene is destroyed - it is a clone, so leave the  geometry and material alone.
        super.destroy();
    }

    get lookGlobal() {
        if (this.isMyPlayerPawn && this.lookOffset) {
            // this is called from ThreeCamera's constructor but the look* values are not intialized yet
            if (!this.actor.inWorld && this.portalLook) return this.portalLook;
            else return this.walkLook;
        } else return this.global;
    }

    get walkLook() {
        const pitchRotation = q_axisAngle([1,0,0], this.lookPitch);
        const m0 = m4_translation(this.lookOffset);
        const m1 = m4_rotationQ(pitchRotation);
        const m2 = m4_multiply(m1, m0);
        return m4_multiply(m2, this.global);
    }

    specForPortal(portal) {
        // we are about to enter this portal. meaning we disappear from this world and appear in the target world
        // visually nothing should change, so we need this avatar's position relative to the portal, as well as
        // its look pitch and offset. This will be passed to frameTypeChanged() in the target world.
        const t = m4_invert(portal.global);
        const m = m4_multiply(this.global, t);
        // const log = (c, m) => console.log(c+"\n"+m.map((v, i) => +v.toFixed(2) + (i % 4 == 3 ? "\n" : ",")).join(''));
        // log("portal", portal.global);
        // log("avatar", this.global);
        // log("m", m);
        const translation = m4_getTranslation(m);
        const rotation = m4_getRotation(m);
        return {
            translation,
            rotation,
            pitch: this.lookPitch,
            yaw: this.lookYaw,
            lookOffset: this.lookOffset,
            presenting: this.presenting,
            cardData: this.actor._cardData,
        };
    }

    frameTypeChanged(isPrimary, spec) {
        // our avatar just came into or left this world, either through a portal
        // (in which case we have a view spec), or through a navigation event (browser's back/forward)
        // in all cases we set the actor's inWorld which will show/hide the avatar
        const enteringWorld = isPrimary;
        const leavingWorld = !isPrimary;
        const actorSpec = {
            inWorld: enteringWorld,
        };
        if (enteringWorld && spec) {
            // move actor to the right place
            actorSpec.translation = spec.translation;
            actorSpec.rotation = spec.rotation;
            actorSpec.cardData = spec.cardData;
            // copy camera settings to pawn
            if (spec.pitch) this.lookPitch = spec.pitch;
            if (spec.yaw) this.lookYaw = spec.yaw;
            if (spec.lookOffset) this.lookOffset = spec.lookOffset;
        }
        if (leavingWorld) this.endMMotion();
        // if we were presenting, tell followers to come with us
        if (leavingWorld && this.presenting) {
            this.say("followMeToWorld", spec.portalURL);
            // calls leaveToWorld() in followers
            // which will result in frameTypeChanged() on follower's clients
        }
        // now actually leave or enter the world (stops presenting in old world)
        this.say("_set", actorSpec);
        // start presenting in new space too
        if (enteringWorld && spec?.presenting) {
            let manager = this.actor.service("PlayerManager");
            if (!manager.presentationMode) {
                this.say("comeToMe");
            }
        }
    }

    leaveToWorld(portalURL) {
        sendToShell("enter-world", { portalURL });
    }

    forceFollow(){
        this.onPosition();
        this.lookPitch = this.actor.lookPitch;
        this.lookYaw = this.actor.lookYaw;
        this.lookOffset = this.actor.lookOffset;
        if (!this._global) {
            this.say("viewGlobalChanged");
            if (this.children) this.children.forEach(child => child.onGlobalChanged()); // If our global changes, so do the globals of our children
        }
       // this.lookTo(this.actor.lookPitch, this.actor.lookYaw, this.actor.lookOffset); 
    }

    update(time, delta) {
        if(this.actor.follow)return;
        if (this.isMyPlayerPawn && this.actor.inWorld) {
            let moving = this.updatePose(delta);
            if (this.actor.fall && time-this.lastUpdateTime>THROTTLE) {
                this.collide();
                this.lastUpdateTime = time;
                this.lastTranslation = this.vq.v;
            }
            if(moving || this.isFalling){
                this.positionTo(this.vq.v, this.vq.q, 50);
             }
            this.refreshPortalClip();
            this.refreshCameraTransform();
        }
        super.update(time, delta);
    }

    // compute motion from spin and velocity
    updatePose(delta){
        let q, v, moving;
        let tug = this.tug;
        if (delta) tug = Math.min(1, tug * delta / 15);

        if (!q_isZero(this.spin)) {
            q=q_normalize(q_slerp(this.rotation, q_multiply(this.rotation, this.spin), tug));
            this.moving = true;
        }else q=this.rotation; 
        if (!v3_isZero(this.velocity)) {
            const relative = v3_scale(this.velocity, delta);
            const move = v3_transform(relative, m4_rotationQ(this.rotation));
            v=v3_add(this.translation, move);
            moving = true;
        }else v=this.translation;
        this.vq = {v:v, q:q};
        return moving;
    }

    refreshPortalClip() {
        if (this.portalClip) {
            let { clippingPlanes } = this.service("ThreeRenderManager").renderer;
            if (this.actor.inWorld) {
                // we are in the world, so we turn off portal clipping
                const idx = clippingPlanes.indexOf(this.portalClip);
                if (idx >= 0) clippingPlanes.splice(idx, 1);
            } else {
                // we are rendering a portal, so we turn on portal clipping
                if (!clippingPlanes.includes(this.portalClip)) {
                    clippingPlanes.push(this.portalClip);
                }
            }
        }
    }

    collideBVH(collideList) {

        // uses:
        // https://github.com/gkjohnson/three-mesh-bvh

        let triPoint = new THREE.Vector3();
        let capsulePoint = new THREE.Vector3();

        const radius = this.actor.collisionRadius;
        let head = EYE_HEIGHT / 6;
        let newPosition = [...this._translation];

        collideList.forEach(c => {
            let iMat = new THREE.Matrix4();
            iMat.copy(c.matrixWorld).invert();

            let v = new THREE.Vector3(...newPosition);
            v.applyMatrix4(iMat); // shift this into the BVH frame

            let segment = new THREE.Line3(v.clone(), v.clone());

            segment.start.y += (head - radius);
            segment.end.y -= (EYE_HEIGHT - radius);
            let cBox = new THREE.Box3();
            cBox.min.set(v.x - radius, v.y - EYE_HEIGHT, v.z - radius);
            cBox.max.set(v.x + radius, v.y + EYE_HEIGHT / 6, v.z + radius);
            // let minDistance = 1000000;
            c.children[0].geometry.boundsTree.shapecast({
                intersectsBounds: box => box.intersectsBox(cBox),
                intersectsTriangle: tri => {
                    const distance = tri.closestPointToSegment(segment, triPoint, capsulePoint);
                    if (distance < radius) {
                        const depth = radius - distance;
                        const direction = capsulePoint.sub(triPoint).normalize();

                        segment.start.addScaledVector(direction, depth);
                        segment.end.addScaledVector(direction, depth);
                    }

                }
            });

            newPosition = segment.start;
            newPosition.applyMatrix4(c.matrixWorld); // convert back to world coordinates
            newPosition.y -= (head - radius);

            /*
            let deltaV = [newPosition.x - this.translation[0],
                newPosition.y - this.translation[1],
                newPosition.z - this.translation[2]
            ];
            */
        })
      //  if (newPosition !== undefined) this.setTranslation(newPosition.toArray());
      // use this.vq.v
    }

    // given the 3D object, find the pawn
    pawnFrom3D(obj3d) {
        while (obj3d) {
            if (obj3d.wcPawn) return obj3d.wcPawn;
            obj3d = obj3d.parent;
        }
        return undefined;
    }

    collidePortal() {
        let portalLayer = this.service("ThreeRenderManager").threeLayer("portal");
        if (!portalLayer) return false;

        let dir = v3_sub(this.vq.v, this.lastTranslation);
        // not moving then return false
        if (!dir.some(item => item !== 0)) return false;

        dir = v3_normalize(dir);
        this.portalcaster.ray.direction.set(...dir);
        this.portalcaster.ray.origin.set(...this.translation);
        const intersections = this.portalcaster.intersectObjects(portalLayer, true);
        if (intersections.length > 0) {
            let portal = this.pawnFrom3D(intersections[0].object);
            if (portal) {
                portal.enterPortal();
                return true;
            }
        }
        return false;
    }

    collide() {
        if (this.collidePortal()) return true;

        let walkLayer = this.service("ThreeRenderManager").threeLayer('walk');
        if (!walkLayer) return false;

        // first check for BVH colliders
        // let collideList = walkLayer.filter(obj => obj.collider);
        // if (collideList.length>0) { this.collideBVH(collideList); return true; }

        // then check for floor objects
        //walkLayer = walkLayer.filter(obj=> !obj.collider);
        //if(walkLayer.length === 0) return false;
        this.walkcaster.ray.origin.set(...this.vq.v);
        const intersections = this.walkcaster.intersectObjects(walkLayer, true);
        if (intersections.length > 0) {
            let dFront = intersections[0].distance;
            let delta = Math.min(dFront - EYE_HEIGHT, EYE_HEIGHT / 8); // can only fall 1/8 EYE_HEIGHT at a time
            if (Math.abs(delta) > EYE_EPSILON) { // moving up or down...
                let t = this.vq.v;
                let p = t[1] - delta;
                this.isFalling  = true;
                this.vq.v[1]=p;
                //this.setFloor(p);
                return true;
            }else {this.isFalling = false; return true; }// we are on level ground
        }return false; // try to find the ground...
    }

    startMMotion() {
        this.say("startMMotion");
    }

    endMMotion() {
        this.activeMMotion = false;
        this.spin = q_identity();
        this.velocity = [0,0,0];
    }

    updateMMotion(dx, dy) {
        // move the avatar
        let v = dy * 0.000075;
        v = Math.min(Math.max(v, -0.01), 0.01);

        const yaw = dx * (isMobile ? -0.00001 : -0.000005);
        this.spin = q_euler(0, yaw ,0);
        this.velocity = [0,0,v];
    }

    keyDown(e) {
        let w = this.wasdVelocity;
        let nw;
        switch(e.key) {
            case 'Tab':
                this.jumpToNote(e); break;
            case 'w': case 'W': // forward
            case 'a': case 'A': // left strafe
            case 'd': case 'D': // right strafe
            case 's': case 'S': // backward
                this.yawDirection = -2;
                this.wasdMap[e.key.toLowerCase()] = true;
                switch (e.key) {
                    case 'w': case 'W': // forward
                        nw = w[2] === 0.01 ? 0 : -0.01;
                        this.wasdVelocity = [w[0], w[1], nw];
                        break;
                    case 'a': case 'A': // left strafe
                        nw = w[0] === 0.01 ? 0 : -0.01;
                        this.wasdVelocity = [nw, w[1], w[2]];
                        break;
                    case 'd': case 'D': // right strafe
                        nw = w[0] === -0.01 ? 0 : 0.01;
                        this.wasdVelocity = [nw, w[1], w[2]];
                        break;
                    case 's': case 'S': // backward
                        nw = w[2] === -0.01 ? 0 : 0.01;
                        this.wasdVelocity = [w[0], w[1], nw];
                        break;
                }
                this.velocity = this.wasdVelocity;
                break;
            default:
                if (e.ctrlKey) {
                    switch(e.key) {
                        case 'a':
                            console.log("MyAvatar");
                            console.log("translation: ",this.actor.translation);
                            console.log("rotation:", q_pitch(this.actor.rotation),
                                q_yaw(this.actor.rotation), q_roll(this.actor.rotation));
                            console.log("scale:", this.actor.scale);
                            break;
                        case 'p':
                            if (this.profiling) {
                                console.log("end profiling");
                                console.profileEnd("profile");
                                this.profiling = false;
                            } else {
                                this.profiling = true;
                                console.log("start profiling");
                                console.profile("profile");
                            }
                            break;
                    }
                }
            /* console.log(e) */
        }
    }

    keyUp(e) {
        switch(e.key) {
            case 'w': case 'W': // forward
            case 'a': case 'A': // left strafe
            case 'd': case 'D': // right strafe
            case 's': case 'S': // backward
                this.yawDirection = -1;
                this.wasdMap[e.key.toLowerCase()] = false;
                let h;
                if (this.wasdMap.a && !this.wasdMap.d) {
                    h = -0.01;
                } else if (!this.wasdMap.a && this.wasdMap.d) {
                    h = 0.01;
                } else {
                    h = 0;
                }
                let v;
                if (this.wasdMap.w && !this.wasdMap.s) {
                    v = -0.01;
                } else if (!this.wasdMap.w && this.wasdMap.s) {
                    v = 0.01;
                } else {
                    v = 0;
                }
                this.wasdVelocity = [h, 0, v];
                this.velocity = this.wasdVelocity;;
        }
    }

    addSticky(e) {
        if (e.shiftKey) {
            const render = this.service("ThreeRenderManager");
            const rc = this.pointerRaycast(e.xy, render.threeLayerUnion('pointer', 'walk'));
            let pe = this.pointerEvent(rc, e);
            this.say("addSticky", pe);
        }
    }

    stopFalling() {
        this.isFalling = false;
    }

    xy2yp(xy) {
        let camera = this.service("ThreeRenderManager").camera;
        let fov = camera.fov / 2;
        let h = window.innerHeight / 2;
        let w = window.innerWidth / 2;
        let c = (fov * Math.PI / 180) / h;
        return[c * (xy[0] - w), c * (h - xy[1])];
    }

    pointerDown(e) {
        if (e.ctrlKey) { // should be the first responder case
            const render = this.service("ThreeRenderManager");
            const rc = this.pointerRaycast(e.xy, render.threeLayerUnion('pointer'));
            this.targetDistance = rc.distance;
            let p3e = this.pointerEvent(rc, e);
            p3e.lookNormal = this.actor.lookNormal;
            let pawn = GetPawn(p3e.targetId);
            pawn = pawn || null;

            if (this.editPawn !== pawn) {
                if (this.editPawn) {
                    console.log('pointerDown clear old editPawn')
                    this.editPawn.unselectEdit();
                    this.editPawn = null;
                    this.editPointerId = null;
                }
                console.log('pointerDown set new editPawn', pawn)
                if (pawn) {
                    this.editPawn = pawn;
                    this.editPointerId = e.id;
                    this.editPawn.selectEdit();
                    this.buttonDown = e.button;
                    if (!p3e.normal) {p3e.normal = this.actor.lookNormal}
                    this.p3eDown = p3e;
                }
            } else {
                console.log("pointerDown in editMode");
            }
        } else {
            if (!this.focusPawn) {
                // because this case is called as the last responder, facusPawn should be always empty
                this.dragWorld = this.xy2yp(e.xy);
                this.lookYaw = q_yaw(this._rotation);
            }
        }
    }

    pointerMove(e) {
        if (this.editPawn) {
            // a pawn is selected for draggging
            if (e.id === this.editPointerId) {
                if (this.buttonDown === 0) {
                    this.editPawn.dragPlane(this.setRayCast(e.xy), this.p3eDown);
                }else if (this.buttonDown == 2) {
                    this.editPawn.rotatePlane(this.setRayCast(e.xy), this.p3eDown);
                }
            }
        }else {
            // we should add and remove responders dynamically so that we don't have to check things this way
            if (!this.focusPawn && this.isPointerDown) {
                let yp = this.xy2yp(e.xy);
                let yaw = (this.lookYaw + (this.dragWorld[0] - yp[0]) * this.yawDirection);
                let pitch = this.lookPitch + this.dragWorld[1] - yp[1];
                pitch = pitch > 1 ? 1 : (pitch < -1 ? -1 : pitch);
                this.dragWorld = yp;
                this.lookTo(pitch, yaw);
            }
        }
    }

    pointerUp(_e) {
        if (this.editPawn) {
            this.editPawn.unselectEdit();
            this.editPawn = null;
            this.editPointerId = null;
            this.p3eDown = null;
            this.buttonDown = null;
        }
    }

    pointerTap(_e) {
        if (this.editPawn) { // this gets set in pointerDown
            this.editPawn.unselectEdit();
            this.editPawn.showControls({avatar: this.actor.id,distance: this.targetDistance});
            this.editPawn = null;
            this.editPointerId = null;
        }
    }

    pointerWheel(e) {
        let z = this.lookOffset[2];
        z += Math.max(1,z) * e.deltaY / 1000.0;
        z = Math.min(100, Math.max(z,0));
        this.lookOffset = [this.lookOffset[0], z, z];
        let pitch = (this.lookPitch * 11 + Math.max(-z / 2, -Math.PI / 4)) / 12;
        this.lookTo(pitch, q_yaw(this._rotation), this.lookOffset); //, 
    }

    fadeNearby() {
        for (let [_viewId, a] of this.actor.service("PlayerManager").players) {
            // a for actor, p for pawn
            let p = GetPawn(a.id);
            if (a.follow) {
                p.setOpacity(0); // get out of my way
            } else if (!this.actor.inWorld) {
                p.setOpacity(1); // we are not even here
            } else {
                let m = this.lookGlobal; // camera location
                let cv = new THREE.Vector3(m[12], m[13], m[14]);
                m = a.global; // avatar location
                let av = new THREE.Vector3(m[12], m[13], m[14]);
                let d = Math.min(1, cv.distanceToSquared(av) / 10);
                p.setOpacity(d);
            }
        }
        this.future(100).fadeNearby();
    }

    setOpacity(opacity) {
        if (this.shape) {
            let transparent = opacity !== 1;
            this.shape.visible = this.actor.inWorld && opacity !== 0;
            this.shape.traverse(n => {
                if (n.material) {
                    n.material.opacity = opacity;
                    n.material.transparent = transparent;
                    n.material.needsUpdate = true;
                }
            });
        }
    }

    goHome() {
        this.say("goHome");
    }

    comeToMe() {
        let manager = this.actor.service("PlayerManager");
        if (!manager.presentationMode) {
            this.say("comeToMe");
            return;
        }

        if (manager.presentationMode === this.viewId) {
            this.say("stopPresentation");
        }
    }

    jumpToNote(e) {
        // collect the notes and jump to the next one or last.
        let cards = this.actor.queryCards({methodName: "filterNotes"}, this);
        let lastIndex;
        if (this.lastCardId === undefined) {
            lastIndex = 0;
        } else {
            lastIndex = cards.findIndex(c => c.id === this.lastCardId);
            if (e.shiftKey) {
                lastIndex--;
            } else {
                lastIndex++;
            }
        }

        if (lastIndex >= cards.length) {
            lastIndex = 0;
        }

        if (lastIndex < 0) {
            lastIndex = cards.length - 1;
        }

        let newCard = cards[lastIndex];

        if (newCard) {
            console.log(newCard);
            this.lastCardId = newCard.id;
            let pawn = GetPawn(newCard.id);
            let pose = pawn.getJumpToPose ? pawn.getJumpToPose() : null;

            if (pose) {
                let obj = {xyz: pose[0], offset: pose[1], look: true, targetId: newCard.id, normal: pawn.hitNormal || [0, 0, 1]};
                this.say("goThere", obj);
            }
        }
    }

    filterNotes(c) {
        return c._behaviorModules && c._behaviorModules.includes("StickyNote");
    }

    setFloor(p) {
        // we don't want to touch the x/z values because they are
        // computed from avatar velocity. _translation x/z values are old.
        let t = this._translation;
        this._translation = [t[0], p, t[2]];
        this.floor = p;
        this.onLocalChanged();
        this.say("setFloor", p, 100);
    }

    loadFromFile(data, asScene) {
        let model = this.actor.wellKnownModel("ModelRoot");

        let array = new TextEncoder().encode(data);
        let ind = 0;
        let key = Math.random();

        this.publish(model.id, "loadStart", key);

        while (ind < array.length) {
            let buf = array.slice(ind, ind + 2880);
            this.publish(model.id, "loadOne", {key, buf});
            ind += 2880;
        }

        this.publish(model.id, "loadDone", {asScene, key});
    }
}
