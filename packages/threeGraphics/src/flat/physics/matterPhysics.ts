/**
 * @author       Yannick Deubel (https://github.com/yandeu)
 * @copyright    Copyright (c) 2021 Yannick Deubel; Project Url: https://github.com/enable3d/enable3d
 * @license      {@link https://github.com/enable3d/enable3d/blob/master/LICENSE|GNU GPLv3}
 */

import { Engine, World, Runner, Bodies, Body, Vertices, Render, Events, Vector } from 'matter-js'
import { Vector2 } from 'three'
import { SimpleSprite } from '../simpleSprite'

const debugSettings = {
  colors: {
    dynamic: '#ff0000', // red
    static: '#90ee90', // lightgreen
    sensor: '#ffff00', // yellow
    sleeping: '#464646' // gray
  },
  lineWidth: 2,
  fill: false,
  opacity: 0.25
}

const getDebugColors = (options: { isStatic?: boolean; isSensor?: boolean; isSleeping?: boolean } = {}) => {
  const { colors } = debugSettings

  if (options.isStatic) return colors.static
  if (options.isSensor) return colors.sensor
  if (options.isSleeping) return colors.sleeping
  return colors.dynamic
}

const adjustDebugColor = (body: Matter.Body, depth = 0, _fill?: string, _stroke?: string) => {
  // get color
  const color = getDebugColors(body)

  const opacity = debugSettings.opacity
  const lineWidth = debugSettings.lineWidth
  const shouldFill = debugSettings.fill

  let fill = _fill ?? color + Math.round(255 * opacity).toString(16)
  if (!shouldFill) fill = _fill ?? 'transparent'
  if (body.isSleeping && !body.isStatic && !body.isSensor) fill = _fill ?? color //+ Math.round(255 * opacity).toString(16)

  const stroke = _stroke ?? color

  body.render.fillStyle = fill
  body.render.strokeStyle = stroke
  body.render.lineWidth = lineWidth

  if (depth >= 5) return

  body.parts.forEach(part => {
    adjustDebugColor(part, depth + 1, fill, stroke)
  })
}

type Circle = { x: number; y: number; radius: number }
type Polygon = { x: number; y: number; sides: number; radius: number }

interface Fixtures {
  label: string
  isSensor: boolean
  circle?: Circle
  polygon?: Polygon
  vertices?: Matter.Vector[][]
}

interface JSONHashPhysicsShapes {
  [key: string]: {
    collisionFilter: { group: number; category: number; mask: number }
    density: number
    fixtures: Fixtures[]
    friction: number
    frictionAir: number
    frictionStatic: number
    isStatic: boolean
    label: string
    restitution: number
    type: string
  }
}

export class MatterPhysics {
  width: number
  height: number

  engine: Engine
  world: Matter.World
  runner: Runner
  render: Render

  _objects: Map<string, SimpleSprite> = new Map()

  parsePhysics(file: string) {
    const json = JSON.parse(file) as JSONHashPhysicsShapes
    delete json['generator_info']

    let bodies: { [key: string]: Fixtures[] } = {}

    for (const key in json) {
      const fixtures = json[key].fixtures
      bodies = { ...bodies, [key]: fixtures }
    }

    return bodies
  }

  addBodyFromFixtures(x: number, y: number, fixtures: Fixtures[]) {
    const bodies: Body[] = []

    fixtures.forEach(fixture => {
      let body

      if (fixture.vertices) {
        body = this.add.fromVertices(x, y, fixture.vertices)
      } else if (fixture.circle) {
        body = this.add.circle(x + fixture.circle.x, y + fixture.circle.y, fixture.circle.radius)
      } else {
        console.log(`Shape not recognized!`)
      }

      if (body) bodies.push(body)
    })

    let body

    if (bodies.length > 1)
      body = Body.create({
        parts: bodies
      })
    else body = bodies[0]

    Body.setPosition(body, { x, y })

    return body
  }

  fromVertices_Fixed(x: number, y: number, vertexSets: Matter.Vector[][], options: Matter.IBodyDefinition = {}) {
    // https://github.com/liabru/matter-js/issues/248#issuecomment-361983251

    const bodies = []

    for (var i = 0; i < vertexSets.length; i++) {
      const body = Bodies.fromVertices(x, y, [vertexSets[i]], { ...options })
      bodies.push(body)

      const centre = Vertices.centre(vertexSets[i])

      Body.setPosition(body, {
        x: body.position.x + centre.x,
        y: body.position.y + centre.y
      })
    }

    const compound = Body.create({
      ...options,
      parts: bodies
    })

    return compound
  }

  private fromVertices(x: number, y: number, vertexSets: Matter.Vector[][], options: Matter.IBodyDefinition = {}) {
    return this.fromVertices_Fixed(x, y, vertexSets, {
      ...options
    })
  }

  public setBounds(x = 0, y = 0, width = this.width, height = this.height, depth = 50) {
    // x = 100
    // y = 100
    // width = 300
    // height = 500

    // walls
    World.add(this.world, [
      // top
      this.add.rectangle(x + width / 2, y + 0 - depth / 2, width + depth * 2, depth, { isStatic: true }),
      // bottom
      this.add.rectangle(x + width / 2, y + height + depth / 2, width + depth * 2, depth, { isStatic: true }),
      // left
      this.add.rectangle(x + 0 - depth / 2, y + height / 2, depth, height + depth * 2, { isStatic: true }),
      // right
      this.add.rectangle(x + width + depth / 2, y + height / 2, depth, height + depth * 2, { isStatic: true })
    ])
  }

  private rectangle(x: number, y: number, width: number, height: number, options: Matter.IBodyDefinition = {}) {
    return Bodies.rectangle(x, y, width, height, {
      ...options
    })
  }

  private circle(x: number, y: number, radius: number, options: Matter.IBodyDefinition = {}) {
    return Bodies.circle(x, y, radius, { ...options })
  }

  private existing(sprite: SimpleSprite) {
    this.add.bodyToSprite(sprite)
    this._objects.set(sprite.body.id.toString(), sprite)
  }

  private calcBodyOffset(sprite: SimpleSprite) {
    const body = sprite.body

    // https://github.com/liabru/matter-js/issues/211#issuecomment-184804576
    const width = body.bounds.max.x - body.bounds.min.x
    const height = body.bounds.max.y - body.bounds.min.y

    const topLeft = Vector.sub(body.bounds.min, body.position)

    const centerOfBody = { x: width / 2, y: height / 2 }
    const centerOfMass = body.position

    const offsetX = topLeft.x + width / 2
    const offsetY = topLeft.y + height / 2
    const offset = { x: offsetX, y: offsetY }

    sprite._bodyOffset = offset
  }

  private _addBodyToSprite(sprite: SimpleSprite) {
    this.add.body(sprite.body)
    this.calcBodyOffset(sprite)
  }

  private _addBody(
    body:
      | Matter.Composite
      | Matter.Body
      | Matter.Body[]
      | Matter.Composite[]
      | Matter.Constraint
      | Matter.Constraint[]
      | Matter.MouseConstraint
  ) {
    World.add(this.world, body)
  }

  get add() {
    return {
      body: this._addBody.bind(this),
      bodyToSprite: this._addBodyToSprite.bind(this),
      fromVertices: this.fromVertices.bind(this),
      circle: this.circle.bind(this),
      existing: this.existing.bind(this),
      rectangle: this.rectangle.bind(this)
    }
  }

  adjustDebugColor(body: Body) {
    adjustDebugColor(body)
  }

  update() {
    this._objects.forEach(object => {
      const { body } = object
      const { angle, position } = body
      const { x, y } = position

      // https://github.com/liabru/matter-js/issues/211#issuecomment-184804576
      const offset = new Vector2(object._bodyOffset.x, object._bodyOffset.y)
      offset.rotateAround(new Vector2(), angle)

      object.setPosition(x + offset.x, this.height - y - offset.y)
      object.setRotation(-angle)

      adjustDebugColor(body)
    })
  }

  constructor(debug = true) {
    this.width = window.innerWidth
    this.height = window.innerHeight

    const DEBUG = debug

    this.engine = Engine.create({ enableSleeping: true })
    this.world = this.engine.world
    this.runner = Runner.create()

    // for debugging
    if (DEBUG) {
      const canvas = document.createElement('canvas')
      canvas.id = 'matter-debug'
      canvas.style.position = 'absolute'
      canvas.style.top = '0px'
      canvas.style.left = '0px'
      canvas.style.pointerEvents = 'none'
      document.body.append(canvas)

      this.render = Render.create({
        canvas: canvas,
        engine: this.engine,

        options: {
          width: this.width,
          height: this.height,
          background: 'transparent',
          wireframeBackground: 'transparent',
          wireframes: false
        }
      })
      Render.run(this.render)
    }

    Runner.run(this.runner, this.engine)

    Events.on(this.engine, 'afterUpdate', () => this.update())
  }
}
