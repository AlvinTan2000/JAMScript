/* eslint-env node */

'use strict';

var fs = require('fs');
var path = require('path');

var ohm = require('ohm-js');
// var es5Translator = require('../ecmascript/es5').es5Translator;
var es5Translator = {};
var es6 = require('../ecmascript/es6');

var jCondTranslator = require('./jCondTranslator');
var symbolTable = require('./symbolTable');
var callGraph = require('./callGraph');
var jdata = require('./jdata');
var activities = require('./activities');

var currentFunction    = "";

var jamJSTranslator = {
  Program: function(directives, elements) {
    var jsout = "";
    var annotated_JS = "";
    var hasJdata = false;
    jsout += "var jcondition = new Map();\n";
    callGraph.addFunction('js', 'root');
    currentFunction = "root";
    for (var i = 0; i < elements.children.length; i++) {
      if(elements.child(i).child(0).child(0).ctorName === "Activity_def") {
        // var output = elements.child(i).child(0).child(0).jamJSTranslator;
        // cout += output.C + '\n';
        // jsout += output.JS + '\n';
        // annotated_JS += output.annotated_JS + '\n';
        jsout += elements.child(i).child(0).child(0).jamJSTranslator;
      } else if(elements.child(i).child(0).child(0).ctorName === "Jconditional") {
        jsout += elements.child(i).child(0).child(0).jamJSTranslator;
      } else if(elements.child(i).child(0).child(0).ctorName === "Jdata_decl") {
        hasJdata = true;
        jsout += elements.child(i).child(0).child(0).jamJSTranslator;
      } else {
        currentFunction = "root";
        jsout += elements.child(i).child(0).child(0).es5Translator + '\n';
      }
    }

    var requires = '';
    if(hasJdata) {
      requires += "var jserver = require('jamserver')(true);\n";
      requires += "var JAMLogger = jserver.JAMLogger;\n";
      requires += "var JAMManager = jserver.JAMManager;\n";
      requires += "const {Flow, InFlow, OutFlow} = require('flows.js')(JAMManager);\n";      
    } else {
      requires += "var jserver = require('jamserver')(false);\n";
    }
    requires += "var jamlib = jserver.jamlib;\n";
    requires += "var jnode = jserver.jnode;\n";


    requires += "var http = require('http');\n";
    requires += "var cbor = require('cbor');\n";
    requires += "var qs = require('querystring');\n";
    requires += "var path = require('path');\n";
    requires += "var mime = require('mime');\n";
    requires += "var fs = require('fs');\n";


    jsout = requires + jsout;
    annotated_JS = requires + annotated_JS;

    return {'JS': jsout, 'annotated_JS': annotated_JS};
  },
  Activity_def: function(node) {
    return node.jamJSTranslator;
  },
  jdata_type: function(type) {
    return type.sourceString;
  },
  Jdata_spec_specified: function(type_spec, id, _1, jdata_type, _2, level, _3, _4) {
    symbolTable.set(id.sourceString, {
      type: "jdata",
      type_spec: type_spec.jamJSTranslator,
      jdata_type: jdata_type.jamJSTranslator
    });
    if (jdata_type.jamJSTranslator === 'logger') {
      return `var ${id.sourceString} = new JAMLogger(JAMManager, "${id.sourceString}");`;
    } else {
      return;
    }
  },
  Jdata_spec_default: function(type_spec, id, _1, jdata_type, _2) {
    symbolTable.set(id.sourceString, {
      type: "jdata",
      type_spec: type_spec.jamJSTranslator,
      jdata_type: jdata_type.jamJSTranslator
    });
    if (jdata_type.jamJSTranslator === 'logger') {
      return `var ${id.sourceString} = new JAMLogger(JAMManager, "${id.sourceString}");`;
    } else {
      return;
    }
  },
  Jdata_spec_flow: function(node, _) {
    return node.jamJSTranslator;
  },
  Jdata_spec: function(node) {
    return node.jamJSTranslator;
  },
  Flow_flow: function(id, _1, _2, _3, func, _4, input) {
    return `var ${id.sourceString} = ${func.sourceString}(Flow.from(${input.sourceString}));`;
  },
  Flow_outflow: function(id, _1, _2, _3, input) {
    return `var ${id.sourceString} = new OutFlow('${id.sourceString}', ${input.sourceString});`;
  },
  Flow_inflow: function(id, _1, _2, _3, input) {
    return `var ${id.sourceString} = ${input.jamJSTranslator};`;
  },
  Flow: function(node) {
    return node.jamJSTranslator;
  },
  inflow_type: function(_1, appName, _2, flowName) {
    return `new InFlow("${appName.sourceString}", "${flowName.sourceString}")`;
  },
  Struct_entry: function(type, id, _) {
    return {
      name: id.sourceString,
      type: type.jamJSTranslator
    };
  },
  C_type_struct: function(_1, id, _2, entries, _3) {
    return {
      name: id.sourceString,
      entries: entries.jamJSTranslator
    };
  },
  C_type_pointer: function(id, pointer) {
    return id.sourceString + "*";
  },
  C_type: function(node) {
    return node.jamJSTranslator;
  },
  Jdata_decl: function(_1, _2, jdata_spec, _3) {
    var output = "";
    var specs = jdata_spec.jamJSTranslator;
    for(var i = 0; i < specs.length; i++) {
      if(specs[i] !== undefined) {
        output += specs[i] + '\n';
      }
    }
    return output;
  },
  Jcond_rule: function(left, op, right) {
    var code = 0;
    // Put sys.type on left hand side, so we don't have to check everything twice
    if(right.sourceString === "sys.type") {
      if(left.sourceString === "sys.type") {
        throw "Cannot have sys.type as both sides of expression";
      } else {
        var temp = right;
        right = left;
        left = temp;
      }
    }
    if(left.sourceString === "sys.type") {
      if(op.sourceString === "==") {
        if(right.sourceString === '"dev"') {
          code = 1;
        } else if(right.sourceString === '"fog"') {
          code = 2;
        } else if(right.sourceString === '"cloud"') {
          code = 4;
        }
      } else if(op.sourceString === "!=") {
        if(right.sourceString === '"dev"') {
          code = 6;
        } else if(right.sourceString === '"fog"') {
          code = 5;
        } else if(right.sourceString === '"cloud"') {
          code = 3;
        }
      } else {
        throw "Operator " + op.sourceString + " not compatible with sys.type";
      }
    } else if(left.sourceString === "sys.sync") {
      if(op.sourceString === ">=" || op.sourceString === "==") {
        if(right.child(0).ctorName === "literal" && Number(right.sourceString) > 0) {
            code = code | 8;
        }
      }
    } else if(left.child(0).ctorName !== "literal" || right.child(0).ctorName !== "literal") {
      code = code | 16;
    }
    return {
      string: "jcondition_context['" + left.sourceString + "'] " + op.sourceString + ' ' + escape(right.sourceString),
      code: code
    };
  },
  Jcond_entry: function(id, _1, rules, _2) {
    var first = rules.child(0).jamJSTranslator;
    var seperators = rules.child(1);
    var rest = rules.child(2);
    var code = first.code;
    var string = first.string;
    for (var i = 0; i < rest.numChildren; i++) {
      string += ' ' + seperators.child(i).sourceString + ' ' + rest.child(i).jamJSTranslator.string;
      code = code | rest.child(i).jamJSTranslator.code;
    }
    return {
      name: id.sourceString,
      string: string,
      code: code
    };
  },
  Jconditional: function(_1, id, _2, entries, _3) {
    var output = "";
    for(var i = 0; i < entries.numChildren; i++) {
      var entry = entries.child(i).jamJSTranslator;
      output += "jcondition.set('" + entry.name + "', { source: '" + entry.string + "', code: " + entry.code + " });\n";
      jCondTranslator.set(entry.name, { source: entry.string, code: entry.code });
    }
    return output;
  },
  Sync_activity: function(_, jCond_spec, functionDeclaration) {
    var jCond = {
      source: "true",
      code: 0
    };
    if(jCond_spec.numChildren > 0) {
      jCond = jCond_spec.jCondTranslator[0];
    }
    var specs = functionDeclaration.jamJSTranslator;
    var rtype;
    var cParams;
    var jParams = specs.params;

    callGraph.addActivity('js', specs.fname, "sync");
    symbolTable.addActivity(specs.fname, {
      language: 'js',
      activityType: "sync",
      jsParams: specs.params,
      jCond: jCond,
      block: specs.block.es5Translator,
      signature: Array(specs.params.length).fill("x")
    });
    return activities.CreateJSSyncMachFunction(specs.fname, jCond, specs.params);
  },
  Async_activity: function(_, jcond_spec, functionDeclaration) {
    var jCond = {
      source: "true",
      code: 0
    };
    if(jcond_spec.numChildren > 0) {
      jCond = jcond_spec.jCondTranslator[0];
    }
    var specs = functionDeclaration.jamJSTranslator;
    callGraph.addActivity('js', specs.fname, "async");
    symbolTable.addActivity(specs.fname, {
      language: 'js',
      activityType: "async",
      name: specs.fname,
      jsParams: specs.params,
      jCond: jCond,
      block: specs.block.es5Translator,
      signature: Array(specs.params.length).fill("x")
    });
    return activities.CreateJSAsyncMachFunction(specs.fname, jCond, specs.params);
  },
  FunctionDeclaration: function(_1, id, _2, params, _3, _4, block, _5) {
    currentFunction = id.es5Translator;
    return {
      fname: id.es5Translator,
      params: params.jamJSTranslator,
      block: block
    };
  },
  FormalParameterList: function(params){
    var paramArray = [];
    if(params.child(0).ctorName === "NonemptyListOf") {
      var list = params.child(0);
      paramArray.push(list.child(0).es5Translator);
      var rest = list.child(2);
      for (var i = 0; i < rest.numChildren; i++) {
        paramArray.push(rest.child(i).es5Translator);
      }
    }
    return paramArray;
  },
  _nonterminal: function(children) {
    var flatChildren = flattenIterNodes(children).sort(compareByInterval);
    var childResults = flatChildren.map(function(n) { return n.jamJSTranslator; });
    if (flatChildren.length === 0 || childResults.every(isUndefined)) {
      return undefined;
    }
    var code = '';
    for (var i = 0; i < flatChildren.length; ++i) {
      if (childResults[i] != null) {
        code += childResults[i];
      }
    }
    return code;
  },
  _terminal: function() {
    return this.sourceString;
  },
  NonemptyListOf: function(first, sep, rest) {
    var code = first.jamJSTranslator;
    for (var i = 0; i < rest.numChildren; i++) {
      code += ' ' + sep.child(i).sourceString + ' ' + rest.child(i).jamJSTranslator;
    }
    return code;
  },

  EmptyListOf: function() {
    return "";
  }
};

es5Translator.AssignmentStatement_expression = function(left, _2, right, _4) {
  var symbol = symbolTable.get(left.es5Translator);

  if(symbol !== undefined) {
    if(symbol.jdata_type === "broadcaster" ) {
      var value;
      // Convert value to a string
      if(symbol.type_spec === "char*") {
        value = `String(${right.es5Translator})`;
      } else {
        value = `String(Number(${right.es5Translator}))`;
      }
      return `JAMManager.broadcastMessage("${left.es5Translator}", ${value});`;
    } else if(symbol.jdata_type === "logger") {
      throw `Cannot write to logger var ${left.es5Translator} from javascript`;
    }
  }
  return left.es5Translator + ' = ' + right.es5Translator + ';';
};

es5Translator.CallExpression_memberExpExp = function(exp, args) {
  callGraph.addCall('js', currentFunction, exp.es5Translator, args.es5Translator);
  return exp.es5Translator + args.es5Translator;
};

es5Translator.CallExpression_callExpExp = function(exp, args) {
  callGraph.addCall('js', currentFunction, exp.es5Translator, args.es5Translator);
  return exp.es5Translator + args.es5Translator;
};

es5Translator.FunctionDeclaration = function(_1, id , _2, params, _3, _4, body, _5) {
  var currentFunction = id.es5Translator;
  if(params.jamJSTranslator.length === 1) {
    symbolTable.addActivity(currentFunction, {
      language: 'js',
      activityType: "async",
      type: "callback",
      signature: ["x"],
      jsParams: params.jamJSTranslator,
      block: body.es5Translator
    });
  }
  symbolTable.addFunction(currentFunction, 'js');
  callGraph.addFunction('js', currentFunction);
  return `function ${id.es5Translator}(${params.es5Translator}) {\n${body.es5Translator}}`;
};
es5Translator.FunctionExpression_named = function(_1, id , _2, params, _3, _4, body, _5) {
  currentFunction = id.es5Translator;
  symbolTable.addFunction(currentFunction, 'js');
  callGraph.addFunction('js', currentFunction);
  return `function ${id.es5Translator}(${params.es5Translator}) {\n${body.es5Translator}}`;
};
es5Translator.FunctionExpression_anonymous = function(_1, _2, params, _3, _4, body, _5) {
  currentFunction = "anonymous";
  symbolTable.addFunction(currentFunction, 'js');
  callGraph.addFunction('js', currentFunction);
  return `function (${params.es5Translator}) {\n${body.es5Translator}}`;
};

function isUndefined(x) { return x === void 0; }

// Take an Array of nodes, and whenever an _iter node is encountered, splice in its
// recursively-flattened children instead.
function flattenIterNodes(nodes) {
  var result = [];
  for (var i = 0; i < nodes.length; ++i) {
    if (nodes[i]._node.ctorName === '_iter') {
      result.push.apply(result, flattenIterNodes(nodes[i].children));
    } else {
      result.push(nodes[i]);
    }
  }
  return result;
}

// Comparison function for sorting nodes based on their source's start index.
function compareByInterval(node, otherNode) {
  return node.source.startIdx - otherNode.source.startIdx;
}
var jamjs = fs.readFileSync(path.join(__dirname, 'jamjs.ohm'));
var ns = { ES5: ohm.grammar(fs.readFileSync(path.join(__dirname, '../ecmascript/es5.ohm'))) };
ns.ES6 = ohm.grammar(fs.readFileSync(path.join(__dirname, '../ecmascript/es6.ohm')), ns);

var jamJSGrammar = ohm.grammar(jamjs, ns);
var semantics = jamJSGrammar.extendSemantics(es6.semantics);

semantics.addAttribute('jamJSTranslator', jamJSTranslator);
// semantics.addAttribute('es5Translator', es5Translator);
semantics.extendAttribute('es5Translator', es5Translator);
semantics.addAttribute('jCondTranslator', jCondTranslator.jCondTranslator);

function translate(tree) {
    return semantics(tree).jamJSTranslator;
}

module.exports = {
  compile: function(input) {
  console.log("Parsing JS Files...");
  var jsTree = jamJSGrammar.match(input, 'Program');
  if(jsTree.failed()) {
    throw jsTree.message;
  }
  console.log("Generating JavaScript Code...");
  return translate(jsTree);
  }
};
