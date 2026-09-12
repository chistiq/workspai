var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    try {
      return (
        mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
        mod.exports
      );
    } catch (e) {
      throw ((mod = 0), e);
    }
  };

// node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  'node_modules/ajv/dist/runtime/ucs2length.js'(exports) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320) pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  },
});

// wis-contract-catalog.validator.js
var validateWisContractCatalogStructure = validate20;
var schema31 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.workspai.dev/wis/core/contract-catalog/0.1.0-draft',
  title: 'WisContractCatalog',
  description: 'Portable digest-bound catalog of generated WIS contracts.',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'status', 'portfolioDigest', 'contracts'],
  properties: {
    schemaVersion: { const: 'workspai-shared-generated-registry.v2' },
    status: { enum: ['candidate', 'stable', 'deprecated'] },
    portfolioDigest: { $ref: '#/$defs/Sha256Digest' },
    contracts: {
      type: 'array',
      minItems: 1,
      maxItems: 1024,
      items: { $ref: '#/$defs/ContractEntry' },
    },
  },
  $defs: {
    NonEmptyString: { type: 'string', minLength: 1, maxLength: 4096 },
    Sha256Digest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
    ContractEntry: {
      type: 'object',
      additionalProperties: false,
      required: [
        'key',
        'id',
        'title',
        'version',
        'dialect',
        'source',
        'digest',
        'typeExport',
        'validatorExport',
        'dependencies',
      ],
      properties: {
        key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,127}$' },
        id: { type: 'string', pattern: '^https://', maxLength: 4096 },
        title: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
        version: { $ref: '#/$defs/NonEmptyString' },
        dialect: { type: 'string', pattern: '^https://', maxLength: 4096 },
        source: {
          type: 'string',
          pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$',
          maxLength: 4096,
        },
        digest: { $ref: '#/$defs/Sha256Digest' },
        typeExport: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
        validatorExport: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
        dependencies: {
          type: 'array',
          maxItems: 128,
          uniqueItems: true,
          items: { type: 'string', pattern: '^https://', maxLength: 4096 },
        },
      },
    },
  },
};
var func0 = Object.prototype.hasOwnProperty;
var pattern4 = new RegExp('^sha256:[a-f0-9]{64}$', 'u');
var schema33 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'key',
    'id',
    'title',
    'version',
    'dialect',
    'source',
    'digest',
    'typeExport',
    'validatorExport',
    'dependencies',
  ],
  properties: {
    key: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,127}$' },
    id: { type: 'string', pattern: '^https://', maxLength: 4096 },
    title: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
    version: { $ref: '#/$defs/NonEmptyString' },
    dialect: { type: 'string', pattern: '^https://', maxLength: 4096 },
    source: {
      type: 'string',
      pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$',
      maxLength: 4096,
    },
    digest: { $ref: '#/$defs/Sha256Digest' },
    typeExport: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
    validatorExport: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
    dependencies: {
      type: 'array',
      maxItems: 128,
      uniqueItems: true,
      items: { type: 'string', pattern: '^https://', maxLength: 4096 },
    },
  },
};
var func81 = require_ucs2length().default;
var pattern5 = new RegExp('^[a-z][a-z0-9-]{0,127}$', 'u');
var pattern6 = new RegExp('^https://', 'u');
var pattern7 = new RegExp('^[A-Za-z][A-Za-z0-9]{0,127}$', 'u');
var pattern9 = new RegExp('^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$', 'u');
function validate21(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate21.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        ((data.key === void 0 || !func0.call(data, 'key')) && (missing0 = 'key')) ||
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.title === void 0 || !func0.call(data, 'title')) && (missing0 = 'title')) ||
        ((data.version === void 0 || !func0.call(data, 'version')) && (missing0 = 'version')) ||
        ((data.dialect === void 0 || !func0.call(data, 'dialect')) && (missing0 = 'dialect')) ||
        ((data.source === void 0 || !func0.call(data, 'source')) && (missing0 = 'source')) ||
        ((data.digest === void 0 || !func0.call(data, 'digest')) && (missing0 = 'digest')) ||
        ((data.typeExport === void 0 || !func0.call(data, 'typeExport')) &&
          (missing0 = 'typeExport')) ||
        ((data.validatorExport === void 0 || !func0.call(data, 'validatorExport')) &&
          (missing0 = 'validatorExport')) ||
        ((data.dependencies === void 0 || !func0.call(data, 'dependencies')) &&
          (missing0 = 'dependencies'))
      ) {
        validate21.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 of Object.keys(data)) {
          if (!func0.call(schema33.properties, key0)) {
            validate21.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.key !== void 0 && func0.call(data, 'key')) {
            let data0 = data.key;
            const _errs2 = errors;
            if (errors === _errs2) {
              if (typeof data0 === 'string') {
                if (!pattern5.test(data0)) {
                  validate21.errors = [
                    {
                      instancePath: instancePath + '/key',
                      schemaPath: '#/properties/key/pattern',
                      keyword: 'pattern',
                      params: { pattern: '^[a-z][a-z0-9-]{0,127}$' },
                      message: 'must match pattern "^[a-z][a-z0-9-]{0,127}$"',
                    },
                  ];
                  return false;
                }
              } else {
                validate21.errors = [
                  {
                    instancePath: instancePath + '/key',
                    schemaPath: '#/properties/key/type',
                    keyword: 'type',
                    params: { type: 'string' },
                    message: 'must be string',
                  },
                ];
                return false;
              }
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.id !== void 0 && func0.call(data, 'id')) {
              let data1 = data.id;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 4096) {
                    validate21.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/properties/id/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 4096 },
                        message: 'must NOT have more than 4096 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (!pattern6.test(data1)) {
                      validate21.errors = [
                        {
                          instancePath: instancePath + '/id',
                          schemaPath: '#/properties/id/pattern',
                          keyword: 'pattern',
                          params: { pattern: '^https://' },
                          message: 'must match pattern "^https://"',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate21.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/properties/id/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs4 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.title !== void 0 && func0.call(data, 'title')) {
                let data2 = data.title;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === 'string') {
                    if (!pattern7.test(data2)) {
                      validate21.errors = [
                        {
                          instancePath: instancePath + '/title',
                          schemaPath: '#/properties/title/pattern',
                          keyword: 'pattern',
                          params: { pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
                          message: 'must match pattern "^[A-Za-z][A-Za-z0-9]{0,127}$"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate21.errors = [
                      {
                        instancePath: instancePath + '/title',
                        schemaPath: '#/properties/title/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.version !== void 0 && func0.call(data, 'version')) {
                  let data3 = data.version;
                  const _errs8 = errors;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (typeof data3 === 'string') {
                      if (func81(data3) > 4096) {
                        validate21.errors = [
                          {
                            instancePath: instancePath + '/version',
                            schemaPath: '#/$defs/NonEmptyString/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 4096 },
                            message: 'must NOT have more than 4096 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func81(data3) < 1) {
                          validate21.errors = [
                            {
                              instancePath: instancePath + '/version',
                              schemaPath: '#/$defs/NonEmptyString/minLength',
                              keyword: 'minLength',
                              params: { limit: 1 },
                              message: 'must NOT have fewer than 1 characters',
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate21.errors = [
                        {
                          instancePath: instancePath + '/version',
                          schemaPath: '#/$defs/NonEmptyString/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.dialect !== void 0 && func0.call(data, 'dialect')) {
                    let data4 = data.dialect;
                    const _errs11 = errors;
                    if (errors === _errs11) {
                      if (typeof data4 === 'string') {
                        if (func81(data4) > 4096) {
                          validate21.errors = [
                            {
                              instancePath: instancePath + '/dialect',
                              schemaPath: '#/properties/dialect/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 4096 },
                              message: 'must NOT have more than 4096 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (!pattern6.test(data4)) {
                            validate21.errors = [
                              {
                                instancePath: instancePath + '/dialect',
                                schemaPath: '#/properties/dialect/pattern',
                                keyword: 'pattern',
                                params: { pattern: '^https://' },
                                message: 'must match pattern "^https://"',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate21.errors = [
                          {
                            instancePath: instancePath + '/dialect',
                            schemaPath: '#/properties/dialect/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.source !== void 0 && func0.call(data, 'source')) {
                      let data5 = data.source;
                      const _errs13 = errors;
                      if (errors === _errs13) {
                        if (typeof data5 === 'string') {
                          if (func81(data5) > 4096) {
                            validate21.errors = [
                              {
                                instancePath: instancePath + '/source',
                                schemaPath: '#/properties/source/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 4096 },
                                message: 'must NOT have more than 4096 characters',
                              },
                            ];
                            return false;
                          } else {
                            if (!pattern9.test(data5)) {
                              validate21.errors = [
                                {
                                  instancePath: instancePath + '/source',
                                  schemaPath: '#/properties/source/pattern',
                                  keyword: 'pattern',
                                  params: {
                                    pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$',
                                  },
                                  message:
                                    'must match pattern "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\).+$"',
                                },
                              ];
                              return false;
                            }
                          }
                        } else {
                          validate21.errors = [
                            {
                              instancePath: instancePath + '/source',
                              schemaPath: '#/properties/source/type',
                              keyword: 'type',
                              params: { type: 'string' },
                              message: 'must be string',
                            },
                          ];
                          return false;
                        }
                      }
                      var valid0 = _errs13 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.digest !== void 0 && func0.call(data, 'digest')) {
                        let data6 = data.digest;
                        const _errs15 = errors;
                        const _errs16 = errors;
                        if (errors === _errs16) {
                          if (typeof data6 === 'string') {
                            if (!pattern4.test(data6)) {
                              validate21.errors = [
                                {
                                  instancePath: instancePath + '/digest',
                                  schemaPath: '#/$defs/Sha256Digest/pattern',
                                  keyword: 'pattern',
                                  params: { pattern: '^sha256:[a-f0-9]{64}$' },
                                  message: 'must match pattern "^sha256:[a-f0-9]{64}$"',
                                },
                              ];
                              return false;
                            }
                          } else {
                            validate21.errors = [
                              {
                                instancePath: instancePath + '/digest',
                                schemaPath: '#/$defs/Sha256Digest/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs15 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.typeExport !== void 0 && func0.call(data, 'typeExport')) {
                          let data7 = data.typeExport;
                          const _errs18 = errors;
                          if (errors === _errs18) {
                            if (typeof data7 === 'string') {
                              if (!pattern7.test(data7)) {
                                validate21.errors = [
                                  {
                                    instancePath: instancePath + '/typeExport',
                                    schemaPath: '#/properties/typeExport/pattern',
                                    keyword: 'pattern',
                                    params: { pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
                                    message: 'must match pattern "^[A-Za-z][A-Za-z0-9]{0,127}$"',
                                  },
                                ];
                                return false;
                              }
                            } else {
                              validate21.errors = [
                                {
                                  instancePath: instancePath + '/typeExport',
                                  schemaPath: '#/properties/typeExport/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs18 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (
                            data.validatorExport !== void 0 &&
                            func0.call(data, 'validatorExport')
                          ) {
                            let data8 = data.validatorExport;
                            const _errs20 = errors;
                            if (errors === _errs20) {
                              if (typeof data8 === 'string') {
                                if (!pattern7.test(data8)) {
                                  validate21.errors = [
                                    {
                                      instancePath: instancePath + '/validatorExport',
                                      schemaPath: '#/properties/validatorExport/pattern',
                                      keyword: 'pattern',
                                      params: { pattern: '^[A-Za-z][A-Za-z0-9]{0,127}$' },
                                      message: 'must match pattern "^[A-Za-z][A-Za-z0-9]{0,127}$"',
                                    },
                                  ];
                                  return false;
                                }
                              } else {
                                validate21.errors = [
                                  {
                                    instancePath: instancePath + '/validatorExport',
                                    schemaPath: '#/properties/validatorExport/type',
                                    keyword: 'type',
                                    params: { type: 'string' },
                                    message: 'must be string',
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid0 = _errs20 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.dependencies !== void 0 && func0.call(data, 'dependencies')) {
                              let data9 = data.dependencies;
                              const _errs22 = errors;
                              if (errors === _errs22) {
                                if (Array.isArray(data9)) {
                                  if (data9.length > 128) {
                                    validate21.errors = [
                                      {
                                        instancePath: instancePath + '/dependencies',
                                        schemaPath: '#/properties/dependencies/maxItems',
                                        keyword: 'maxItems',
                                        params: { limit: 128 },
                                        message: 'must NOT have more than 128 items',
                                      },
                                    ];
                                    return false;
                                  } else {
                                    var valid3 = true;
                                    const len0 = data9.length;
                                    for (let i0 = 0; i0 < len0; i0++) {
                                      let data10 = data9[i0];
                                      const _errs24 = errors;
                                      if (errors === _errs24) {
                                        if (typeof data10 === 'string') {
                                          if (func81(data10) > 4096) {
                                            validate21.errors = [
                                              {
                                                instancePath: instancePath + '/dependencies/' + i0,
                                                schemaPath:
                                                  '#/properties/dependencies/items/maxLength',
                                                keyword: 'maxLength',
                                                params: { limit: 4096 },
                                                message: 'must NOT have more than 4096 characters',
                                              },
                                            ];
                                            return false;
                                          } else {
                                            if (!pattern6.test(data10)) {
                                              validate21.errors = [
                                                {
                                                  instancePath:
                                                    instancePath + '/dependencies/' + i0,
                                                  schemaPath:
                                                    '#/properties/dependencies/items/pattern',
                                                  keyword: 'pattern',
                                                  params: { pattern: '^https://' },
                                                  message: 'must match pattern "^https://"',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                        } else {
                                          validate21.errors = [
                                            {
                                              instancePath: instancePath + '/dependencies/' + i0,
                                              schemaPath: '#/properties/dependencies/items/type',
                                              keyword: 'type',
                                              params: { type: 'string' },
                                              message: 'must be string',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid3 = _errs24 === errors;
                                      if (!valid3) {
                                        break;
                                      }
                                    }
                                    if (valid3) {
                                      let i1 = data9.length;
                                      let j0;
                                      if (i1 > 1) {
                                        const indices0 = {};
                                        for (; i1--;) {
                                          let item0 = data9[i1];
                                          if (typeof item0 !== 'string') {
                                            continue;
                                          }
                                          if (typeof indices0[item0] == 'number') {
                                            j0 = indices0[item0];
                                            validate21.errors = [
                                              {
                                                instancePath: instancePath + '/dependencies',
                                                schemaPath: '#/properties/dependencies/uniqueItems',
                                                keyword: 'uniqueItems',
                                                params: { i: i1, j: j0 },
                                                message:
                                                  'must NOT have duplicate items (items ## ' +
                                                  j0 +
                                                  ' and ' +
                                                  i1 +
                                                  ' are identical)',
                                              },
                                            ];
                                            return false;
                                            break;
                                          }
                                          indices0[item0] = i1;
                                        }
                                      }
                                    }
                                  }
                                } else {
                                  validate21.errors = [
                                    {
                                      instancePath: instancePath + '/dependencies',
                                      schemaPath: '#/properties/dependencies/type',
                                      keyword: 'type',
                                      params: { type: 'array' },
                                      message: 'must be array',
                                    },
                                  ];
                                  return false;
                                }
                              }
                              var valid0 = _errs22 === errors;
                            } else {
                              var valid0 = true;
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate21.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate21.errors = vErrors;
  return errors === 0;
}
validate21.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate20(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate20.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if (
        ((data.schemaVersion === void 0 || !func0.call(data, 'schemaVersion')) &&
          (missing0 = 'schemaVersion')) ||
        ((data.status === void 0 || !func0.call(data, 'status')) && (missing0 = 'status')) ||
        ((data.portfolioDigest === void 0 || !func0.call(data, 'portfolioDigest')) &&
          (missing0 = 'portfolioDigest')) ||
        ((data.contracts === void 0 || !func0.call(data, 'contracts')) && (missing0 = 'contracts'))
      ) {
        validate20.errors = [
          {
            instancePath,
            schemaPath: '#/required',
            keyword: 'required',
            params: { missingProperty: missing0 },
            message: "must have required property '" + missing0 + "'",
          },
        ];
        return false;
      } else {
        const _errs1 = errors;
        for (const key0 of Object.keys(data)) {
          if (!(
            key0 === 'schemaVersion' ||
            key0 === 'status' ||
            key0 === 'portfolioDigest' ||
            key0 === 'contracts'
          )) {
            validate20.errors = [
              {
                instancePath,
                schemaPath: '#/additionalProperties',
                keyword: 'additionalProperties',
                params: { additionalProperty: key0 },
                message: 'must NOT have additional properties',
              },
            ];
            return false;
            break;
          }
        }
        if (_errs1 === errors) {
          if (data.schemaVersion !== void 0 && func0.call(data, 'schemaVersion')) {
            const _errs2 = errors;
            if ('workspai-shared-generated-registry.v2' !== data.schemaVersion) {
              validate20.errors = [
                {
                  instancePath: instancePath + '/schemaVersion',
                  schemaPath: '#/properties/schemaVersion/const',
                  keyword: 'const',
                  params: { allowedValue: 'workspai-shared-generated-registry.v2' },
                  message: 'must be equal to constant',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.status !== void 0 && func0.call(data, 'status')) {
              let data1 = data.status;
              const _errs3 = errors;
              if (!(data1 === 'candidate' || data1 === 'stable' || data1 === 'deprecated')) {
                validate20.errors = [
                  {
                    instancePath: instancePath + '/status',
                    schemaPath: '#/properties/status/enum',
                    keyword: 'enum',
                    params: { allowedValues: schema31.properties.status.enum },
                    message: 'must be equal to one of the allowed values',
                  },
                ];
                return false;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.portfolioDigest !== void 0 && func0.call(data, 'portfolioDigest')) {
                let data2 = data.portfolioDigest;
                const _errs4 = errors;
                const _errs5 = errors;
                if (errors === _errs5) {
                  if (typeof data2 === 'string') {
                    if (!pattern4.test(data2)) {
                      validate20.errors = [
                        {
                          instancePath: instancePath + '/portfolioDigest',
                          schemaPath: '#/$defs/Sha256Digest/pattern',
                          keyword: 'pattern',
                          params: { pattern: '^sha256:[a-f0-9]{64}$' },
                          message: 'must match pattern "^sha256:[a-f0-9]{64}$"',
                        },
                      ];
                      return false;
                    }
                  } else {
                    validate20.errors = [
                      {
                        instancePath: instancePath + '/portfolioDigest',
                        schemaPath: '#/$defs/Sha256Digest/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs4 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.contracts !== void 0 && func0.call(data, 'contracts')) {
                  let data3 = data.contracts;
                  const _errs7 = errors;
                  if (errors === _errs7) {
                    if (Array.isArray(data3)) {
                      if (data3.length > 1024) {
                        validate20.errors = [
                          {
                            instancePath: instancePath + '/contracts',
                            schemaPath: '#/properties/contracts/maxItems',
                            keyword: 'maxItems',
                            params: { limit: 1024 },
                            message: 'must NOT have more than 1024 items',
                          },
                        ];
                        return false;
                      } else {
                        if (data3.length < 1) {
                          validate20.errors = [
                            {
                              instancePath: instancePath + '/contracts',
                              schemaPath: '#/properties/contracts/minItems',
                              keyword: 'minItems',
                              params: { limit: 1 },
                              message: 'must NOT have fewer than 1 items',
                            },
                          ];
                          return false;
                        } else {
                          var valid2 = true;
                          const len0 = data3.length;
                          for (let i0 = 0; i0 < len0; i0++) {
                            const _errs9 = errors;
                            if (
                              !validate21(data3[i0], {
                                instancePath: instancePath + '/contracts/' + i0,
                                parentData: data3,
                                parentDataProperty: i0,
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate21.errors
                                  : vErrors.concat(validate21.errors);
                              errors = vErrors.length;
                            }
                            var valid2 = _errs9 === errors;
                            if (!valid2) {
                              break;
                            }
                          }
                        }
                      }
                    } else {
                      validate20.errors = [
                        {
                          instancePath: instancePath + '/contracts',
                          schemaPath: '#/properties/contracts/type',
                          keyword: 'type',
                          params: { type: 'array' },
                          message: 'must be array',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs7 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate20.errors = [
        {
          instancePath,
          schemaPath: '#/type',
          keyword: 'type',
          params: { type: 'object' },
          message: 'must be object',
        },
      ];
      return false;
    }
  }
  validate20.errors = vErrors;
  return errors === 0;
}
validate20.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export { validateWisContractCatalogStructure };
