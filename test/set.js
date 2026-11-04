var test = require('tape');
var traverse = require('../');

var has = Object.prototype.hasOwnProperty;

var protoDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
// where `__proto__` is an accessor, an own `__proto__` data property can be created
var hasOwnProto = !!(protoDescriptor && typeof protoDescriptor.set === 'function');

var builtins = [
    { name : 'Object.prototype', value : Object.prototype },
    { name : 'Function.prototype', value : Function.prototype },
    { name : 'Array.prototype', value : Array.prototype },
    { name : 'String.prototype', value : String.prototype },
    { name : 'Number.prototype', value : Number.prototype },
    { name : 'Boolean.prototype', value : Boolean.prototype },
    { name : 'Number', value : Number },
    { name : 'Number.prototype.toString', value : Number.prototype.toString }
];

function getState () {
    var state = [];
    for (var i = 0; i < builtins.length; i++) {
        state[i] = {
            names : Object.getOwnPropertyNames(builtins[i].value),
            proto : Object.getPrototypeOf(builtins[i].value)
        };
    }
    return state;
}

// reverts as it reports, so that a failure here can not cascade into the tests that run after it
function undoPollution (state) {
    var pollution = [];
    for (var i = 0; i < builtins.length; i++) {
        var builtin = builtins[i].value;
        var names = Object.getOwnPropertyNames(builtin);
        for (var j = 0; j < names.length; j++) {
            if (state[i].names.indexOf(names[j]) < 0) {
                pollution.push(builtins[i].name + ' gained `' + names[j] + '`');
                delete builtin[names[j]];
            }
        }
        if (Object.getPrototypeOf(builtin) !== state[i].proto) {
            pollution.push(builtins[i].name + ' has a different [[Prototype]]');
        }
    }
    return pollution;
}

function getOwnProto (obj) {
    var desc = Object(obj) === obj && Object.getOwnPropertyDescriptor(obj, '__proto__');
    return desc ? desc.value : undefined;
}

function throwsTypeError (t, fn, msg) {
    var caught;
    try { fn() }
    catch (err) { caught = err }
    t.ok(caught instanceof TypeError, msg);
}

test('set', function (t) {
    var state = getState();

    var obj = { a : { b : 1 }, c : [ 1, 2 ] };

    t.equal(traverse(obj).set([ 'a', 'b' ], 2), 2, 'returns the value');
    t.deepEqual(obj, { a : { b : 2 }, c : [ 1, 2 ] }, 'replaces an existing value');

    var a = obj.a;
    traverse(obj).set([ 'a', 'd', 'e' ], 3);
    t.equal(obj.a, a, 'keeps the existing nodes on the path');
    t.deepEqual(obj, { a : { b : 2, d : { e : 3 } }, c : [ 1, 2 ] }, 'creates the missing nodes on the path');

    t.equal(traverse.set(obj, [ 'f', 'g' ], 6), 6, 'static form returns the value');
    t.deepEqual(obj.f, { g : 6 }, 'static form sets the value');

    var inherited = {};
    traverse(inherited).set([ 'constructor', 'prototype', 'polluted' ], 'yes');
    t.ok(has.call(inherited, 'constructor'), 'an inherited key is created as an own property');
    // compared as JSON: this tape's deepEqual treats an own `prototype` key as the function `.prototype`
    t.equal(JSON.stringify(inherited.constructor), '{"prototype":{"polluted":"yes"}}', 'an inherited value is not descended into');
    t.ok(!('polluted' in Object.prototype), 'Object.prototype is not polluted');

    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 'b', 'c' ], 2) }, 'a path that crosses a primitive throws');
    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 'b' ], 2) }, 'a path that ends on a primitive throws');
    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 0 ], 2) }, 'a path that ends on a primitive, with an index, throws');

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set coerces each path segment once', function (t) {
    var state = getState();

    var calls = 0;
    var segment = {
        toString : function () {
            calls += 1;
            return calls > 1 ? '__proto__' : 'a';
        }
    };
    var obj = { a : {} };

    traverse(obj).set([ segment, 'polluted' ], 'yes');

    t.equal(calls, 1, 'segment is coerced once');
    t.deepEqual(obj, { a : { polluted : 'yes' } }, 'the same key is used throughout');
    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set with a __proto__ segment', function (t) {
    var state = getState();
    var value = { isAdmin : true };
    var paths = [
        [ '__proto__' ],
        [ '__proto__', 'polluted' ],
        [ 'a', '__proto__' ],
        [ 'a', '__proto__', 'polluted' ],
        [ [ '__proto__' ], 'polluted' ]
    ];

    if (hasOwnProto) {
        var obj = {};
        t.equal(traverse(obj).set([ '__proto__', 'x' ], 1), 1, 'returns the value');
        t.deepEqual(getOwnProto(obj), { x : 1 }, 'creates an own `__proto__`');
        t.equal(Object.getPrototypeOf(obj), Object.prototype, '[[Prototype]] is unchanged');
        t.ok(!('x' in obj), 'does not inherit from the `__proto__` value');
        t.equal(traverse(obj).get([ '__proto__', 'x' ]), 1, 'get finds the value');

        var last = { a : {} };
        traverse(last).set([ 'a', '__proto__' ], value);
        t.equal(getOwnProto(last.a), value, 'as the last segment, sets an own `__proto__`');
        t.equal(Object.getPrototypeOf(last.a), Object.prototype, 'as the last segment, [[Prototype]] is unchanged');

        var coerced = {};
        traverse(coerced).set([ [ '__proto__' ], 'x' ], 1);
        t.deepEqual(getOwnProto(coerced), { x : 1 }, 'coerced from an object, creates an own `__proto__`');
        t.equal(Object.getPrototypeOf(coerced), Object.prototype, 'coerced from an object, [[Prototype]] is unchanged');

        throwsTypeError(t, function () {
            traverse(Object.freeze({})).set([ '__proto__', 'x' ], 1);
        }, 'a non-extensible object throws');
    }
    else {
        var targets = [ {}, { a : {} }, [] ];
        for (var i = 0; i < targets.length; i++) {
            var proto = Object.getPrototypeOf(targets[i]);
            for (var j = 0; j < paths.length; j++) {
                (function (target, path, label) {
                    var caught;
                    try { traverse(target).set(path, value) }
                    catch (err) { caught = err }
                    // `[ 'a', ... ]` paths on a target without `a` create it first, then hit `__proto__`
                    t.ok(caught instanceof TypeError, label + ': throws');
                })(targets[i], paths[j], 'target ' + i + ', path ' + j);
                t.equal(Object.getPrototypeOf(targets[i]), proto, 'target ' + i + ', path ' + j + ': [[Prototype]] is unchanged');
            }
        }
        t.equal(Object.getPrototypeOf(targets[1].a), Object.prototype, 'nested [[Prototype]] is unchanged');
    }

    t.deepEqual(value, { isAdmin : true }, 'value is not modified');
    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set does not pollute built-in prototypes', function (t) {
    var state = getState();

    var cases = [
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', [ '__proto__' ], 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 'length', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 0, '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 'constructor', 'prototype', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', '__proto__', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'constructor', 'prototype', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'constructor', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'toString', 'polluted' ] },
        { target : { b : true }, path : [ 'b', '__proto__', 'polluted' ] },
        { target : [], path : [ 'length', '__proto__', 'polluted' ] },
        { target : function () {}, path : [ 'length', '__proto__', 'polluted' ] },
        { target : 'x', path : [ '__proto__', 'polluted' ] },
        { target : 'x', path : [ '__proto__' ] },
        { target : 'x', path : [ 'constructor', 'prototype', 'polluted' ] },
        { target : 1, path : [ '__proto__', 'polluted' ] },
        { target : true, path : [ '__proto__', 'polluted' ] }
    ];
    var value = { isAdmin : true };

    for (var i = 0; i < cases.length; i++) {
        (function (c, label) {
            throwsTypeError(t, function () { traverse(c.target).set(c.path, value) }, label + ': throws');
            t.deepEqual(undoPollution(state), [], label + ': no built-in is modified');
            throwsTypeError(t, function () { traverse.set(c.target, c.path, value) }, label + ': static form throws');
            t.deepEqual(undoPollution(state), [], label + ': static form modifies no built-in');
        })(cases[i], 'case ' + i);
    }

    t.deepEqual(value, { isAdmin : true }, 'value is not modified');
    t.end();
});

test('set does not descend into a property it could not create', function (t) {
    var state = getState();

    var shared = {};
    var calls = [];
    function Config () {}
    Object.defineProperty(Config.prototype, 'defaults', {
        configurable : true,
        get : function () { return shared },
        set : function (x) { calls.push(x) }
    });

    throwsTypeError(t, function () {
        traverse(new Config).set([ 'defaults', 'polluted' ], 'yes');
    }, 'an inherited accessor in the middle of the path throws');
    t.deepEqual(shared, {}, 'the inherited value is not modified');

    var config = new Config;
    t.equal(traverse(config).set([ 'defaults' ], 'yes'), 'yes', 'an inherited accessor as the last segment returns the value');
    t.deepEqual(calls.slice(-1), [ 'yes' ], 'an inherited accessor as the last segment is still assigned to');
    t.ok(!has.call(config, 'defaults'), 'an inherited accessor as the last segment creates no own property');

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});
