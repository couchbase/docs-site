// this test file is designed to be run with Mocha
const assert = require('assert')
const fs = require('fs')
const yaml = require('js-yaml')
const ok = specify
const {format_type, child_entries, process_toc} = require('../lib/helpers/lib/each-openapi-module.js')

describe('process_toc', function () {
  ok('via process_toc', function () {
    const bundledAdmin = yaml.load(
      fs.readFileSync('home/modules/contribute/examples/bundled-admin.yaml', 'utf8'))

    const toc = process_toc(bundledAdmin.components.schemas.Database)
    fs.writeFileSync('test/fixtures/toc-example.html.actual', toc)

    const expected = fs.readFileSync('test/fixtures/toc-example.html', 'utf8')

    assert.equal(toc, expected)
  })

  ok('process_toc of Bootstrap schema', function () {
    const bundledAdmin = yaml.load(
      fs.readFileSync('home/modules/contribute/examples/bundled-admin.yaml', 'utf8'))

    const toc = process_toc(bundledAdmin.components.schemas["Startup-config"])
    fs.writeFileSync('test/fixtures/toc-bootstrap.html.actual', toc)

    const expected = fs.readFileSync('test/fixtures/toc-bootstrap.html', 'utf8')

    assert.equal(toc, expected)
  })

  ok('process_toc simple no type', function () {
    const schema = yaml.load(`
      properties:
        bar:
          type: string
          description: The bar property.`)
    const toc = process_toc(schema)
    const expected = `
      { 
        <a href="#bar">bar</a>: "string" 
      }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('simple no type, using single allOf with type:object', function () {
    const schema = yaml.load(`
      allOf:
        - type: object
          properties:
            bar:
              type: string
              description: The bar property.`)
    const toc = process_toc(schema)
    const expected = `
      {
        <a href="#bar">bar</a>: "string"
      }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('simple no type, using single allOf without type:object', function () {
    const schema = yaml.load(`
      allOf:
        - type: object
          properties:
            bar:
              type: string
              description: The bar property.`)
    const toc = process_toc(schema)
    const expected = `
      {
        <a href="#bar">bar</a>: "string"
      }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('multiple properties without allOf', function () {
    const schema = yaml.load(`
      properties:
        bar:
          type: string
          description: The bar property.
        foo:
          type: string
          description: The foo property.`)
    const toc = process_toc(schema)
    const expected = `
      {
        <a href="#bar">bar</a>: "string",
        <a href="#foo">foo</a>: "string"
      }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('multiple allOf with type:object', function () {
    const schema = yaml.load(`
      allOf:
        - type: object
          properties:
            bar:
              type: string
              description: The bar property.
        - type: object
          properties:
            foo:
              type: string
              description: The bar property.`)
    const toc = process_toc(schema)
    const expected = `
      {
        <a href="#bar">bar</a>: "string",
        <a href="#foo">foo</a>: "string"
      }`
    assert_equal_no_whitespace(expected, toc);
  })

  // FIXME, verify this output makes sense, not sure if this is how we should display additionalProperties
  ok('basic additionalProperties', function () {
    const schema = yaml.load(`
      additionalProperties:
        properties:
          bar:
            type: string
            description: The bar property.`)
    const toc = process_toc(schema)
    const expected = `
      { {additionalProperties...}: {
          <a href="#{additionalProperties}-bar">bar</a>: "string"
      } }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('additionalProperties, empty"', function () {
    const schema = yaml.load(`
      additionalProperties: {}`)
    const toc = process_toc(schema)
    const expected = `
      { {additionalProperties...}: {
      } }`
    assert_equal_no_whitespace(expected, toc);
  })

  ok('additionalProperties: true""', function () {
    const schema = yaml.load(`
      additionalProperties: true`)
    const toc = process_toc(schema)
    const expected = `
      { {additionalProperties...}: {
      } }`
    assert_equal_no_whitespace(expected, toc);
  })
})

describe('format_type', function () {
  ok('format_type object', function () {
    assert.equal(
      format_type({type: 'object'}), 
      null)
  })

  ok('format_type string example', function () {
    assert.equal(
      format_type({type: 'string', example: 'Bob', default: 'Jane'}), 
      '"Bob"')
  })

  ok('format_type string default', function () {
    assert.equal(
      format_type({type: 'string', default: 'Jane'}), 
      '"Jane"')
  })

  ok('format_type number fallback', function () {
    assert.equal(
      format_type({type: 'number'}), 
      0) // SHOULD this be '0.0' as a string?
  })

  ok('format_type array fallback', function () {
    assert.equal(
      format_type({type: 'array'}), 
      '[]')
  })

  ok('format_type other', function () {
    assert.equal(
      format_type({type: 'other'}), 
      'other')
  })

  ok('format_type unknown', function () {
    assert.equal(
      format_type({}), 
      '(unknown)') // fallback for odd cases missing type
  })
})

describe('child_entries', function () {
  ok('via properties', function () {
    assert.deepEqual(
      child_entries({properties: {
        'foo': {type: 'string'}, 
        'bar': {type: 'number'}
      }}), 
      [
        ["foo", {type: 'string'}],
        ["bar", {type: 'number'}]
      ])
  })

  ok('via additionalProperties boolean', function () {
    assert.deepEqual(
      child_entries({additionalProperties: true}),
      [
        [
          '{additionalProperties...}',
          {type: 'object'}
        ]
      ])
  })

  ok('via additionalProperties object', function () {
    assert.deepEqual(
      child_entries({additionalProperties: {
        "x-additionalPropertiesName": "dbname",
        "description": "The name of the database.",
        "type": "object",
        "properties": {
          "seq": {
            "description": "The latest sequence number in the database.",
            "type": "number",
            "minimum": 0
          },
          "server_uuid": {
            "description": "The server unique identifier.",
            "type": "string"
          }
        }
      }}),
      [[
        '{dbname...}',
        {
          type: 'object',
          "description": "The name of the database.",
          "x-additionalPropertiesName": "dbname",
          properties: {
            seq: {
              description: 'The latest sequence number in the database.',
              type: 'number',
              minimum: 0
            },
            server_uuid: {
              description: 'The server unique identifier.',
              type: 'string'
            }
          }
        }
      ]])
  })

  ok('via additionalProperties object without properties  name', function () {
    assert.deepEqual(
      child_entries({additionalProperties: {
        "description": "The name of the database.",
        "type": "object",
        "properties": {
          "seq": {
            "description": "The latest sequence number in the database.",
            "type": "number",
            "minimum": 0
          },
          "server_uuid": {
            "description": "The server unique identifier.",
            "type": "string"
          }
        }
      }}),
      [[
        '{additionalProperties...}',
        {
          type: 'object',
          "description": "The name of the database.",
          properties: {
            seq: {
              description: 'The latest sequence number in the database.',
              type: 'number',
              minimum: 0
            },
            server_uuid: {
              description: 'The server unique identifier.',
              type: 'string'
            }
          }
        }
      ]])
  })

  ok('via allOf', function () {
    assert.deepEqual(
      child_entries({
        allOf: [
          {properties: {'foo': {type: 'string'}}},
          {properties: {'bar': {type: 'number'}}}
        ]
      }),
      [
        ['foo', {type: 'string'}],
        ['bar', {type: 'number'}]
      ])
  })
})

// Helper function to clean up whitespace in strings for comparison
const cleanup_whitespace = (str) => str.replace(/\s+/g, ' ').trim()
function assert_equal_no_whitespace (actual, expected) {
  assert.equal(
    cleanup_whitespace(actual),
    cleanup_whitespace(expected))
}