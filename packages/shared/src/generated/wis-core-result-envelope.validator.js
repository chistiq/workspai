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

// ../../node_modules/fast-deep-equal/index.js
var require_fast_deep_equal = __commonJS({
  '../../node_modules/fast-deep-equal/index.js'(exports, module) {
    'use strict';
    module.exports = function equal(a, b) {
      if (a === b) return true;
      if (a && b && typeof a == 'object' && typeof b == 'object') {
        if (a.constructor !== b.constructor) return false;
        var length, i, keys;
        if (Array.isArray(a)) {
          length = a.length;
          if (length != b.length) return false;
          for (i = length; i-- !== 0;) if (!equal(a[i], b[i])) return false;
          return true;
        }
        if (a.constructor === RegExp) return a.source === b.source && a.flags === b.flags;
        if (a.valueOf !== Object.prototype.valueOf) return a.valueOf() === b.valueOf();
        if (a.toString !== Object.prototype.toString) return a.toString() === b.toString();
        keys = Object.keys(a);
        length = keys.length;
        if (length !== Object.keys(b).length) return false;
        for (i = length; i-- !== 0;)
          if (!Object.prototype.hasOwnProperty.call(b, keys[i])) return false;
        for (i = length; i-- !== 0;) {
          var key = keys[i];
          if (!equal(a[key], b[key])) return false;
        }
        return true;
      }
      return a !== a && b !== b;
    };
  },
});

// node_modules/ajv/dist/runtime/equal.js
var require_equal = __commonJS({
  'node_modules/ajv/dist/runtime/equal.js'(exports) {
    'use strict';
    Object.defineProperty(exports, '__esModule', { value: true });
    var equal = require_fast_deep_equal();
    equal.code = 'require("ajv/dist/runtime/equal").default';
    exports.default = equal;
  },
});

// wis-core-result-envelope.validator.js
var validateWisCoreResultEnvelopeStructure = validate23;
var schema36 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://schemas.workspai.dev/wis/core/result-envelope/0.2.0-draft',
  title: 'WisCoreResultEnvelope',
  description: 'SH2 candidate binding for the review-pending WIS Core result envelope.',
  type: 'object',
  additionalProperties: false,
  required: [
    'specVersion',
    'coreVersion',
    'schemaId',
    'profile',
    'producer',
    'operation',
    'operationOutcome',
    'scope',
    'generation',
    'status',
    'evidence',
    'freshness',
    'unknowns',
    'omissions',
    'diagnostics',
    'compatibility',
  ],
  properties: {
    specVersion: { $ref: '#/$defs/NonEmptyIdentifier' },
    coreVersion: { const: '0.2.0-draft' },
    schemaId: { $ref: '#/$defs/NonEmptyIdentifier' },
    profile: { $ref: '#/$defs/ProfileReference' },
    artifactId: { $ref: '#/$defs/NonEmptyIdentifier' },
    producer: { $ref: '#/$defs/ProducerReference' },
    operation: { $ref: '#/$defs/NonEmptyIdentifier' },
    operationOutcome: { enum: ['succeeded', 'failed', 'cancelled'] },
    scope: { $ref: '#/$defs/ScopeReference' },
    generation: { $ref: '#/$defs/GenerationReference' },
    status: { enum: ['pass', 'attention', 'blocked', 'partial', 'failed'] },
    payload: true,
    evidence: { type: 'array', maxItems: 1e4, items: { $ref: '#/$defs/EvidenceReference' } },
    freshness: { $ref: '#/$defs/FreshnessSummary' },
    unknowns: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/UnknownRecord' } },
    omissions: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/OmissionRecord' } },
    diagnostics: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/Diagnostic' } },
    compatibility: { $ref: '#/$defs/CompatibilitySummary' },
    extensions: { $ref: '#/$defs/Extensions' },
  },
  $defs: {
    NonEmptyIdentifier: { type: 'string', minLength: 1, maxLength: 512 },
    PortableRelativeLocator: { type: 'string', minLength: 1, maxLength: 4096 },
    Timestamp: {
      type: 'string',
      pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$',
    },
    ContractReference: {
      title: 'WisContractReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'version'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        version: { $ref: '#/$defs/NonEmptyIdentifier' },
        profile: { $ref: '#/$defs/NonEmptyIdentifier' },
      },
    },
    ProfileReference: {
      title: 'WisProfileReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'version'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        version: { $ref: '#/$defs/NonEmptyIdentifier' },
      },
    },
    ProducerReference: {
      title: 'WisProducerReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'version'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        version: { $ref: '#/$defs/NonEmptyIdentifier' },
        extensions: {
          type: 'array',
          maxItems: 128,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
      },
    },
    ProjectScope: {
      title: 'WisProjectScopeReference',
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'projectIds'],
      properties: {
        kind: { const: 'project' },
        workspaceId: { $ref: '#/$defs/NonEmptyIdentifier' },
        projectIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1e4,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
      },
    },
    WorkspaceScope: {
      title: 'WisWorkspaceScopeReference',
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'workspaceId'],
      properties: {
        kind: { const: 'workspace' },
        workspaceId: { $ref: '#/$defs/NonEmptyIdentifier' },
      },
    },
    SelectionScope: {
      title: 'WisSelectionScopeReference',
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { const: 'selection' },
        workspaceId: { $ref: '#/$defs/NonEmptyIdentifier' },
        projectIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1e4,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        entityIds: {
          type: 'array',
          minItems: 1,
          maxItems: 1e4,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        selector: { type: 'string', minLength: 1, maxLength: 4096 },
      },
    },
    OrganizationScope: {
      title: 'WisOrganizationScopeReference',
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'organizationId'],
      properties: {
        kind: { const: 'organization' },
        organizationId: { $ref: '#/$defs/NonEmptyIdentifier' },
        workspaceId: { $ref: '#/$defs/NonEmptyIdentifier' },
      },
    },
    ScopeReference: {
      title: 'WisScopeReference',
      oneOf: [
        { $ref: '#/$defs/ProjectScope' },
        { $ref: '#/$defs/WorkspaceScope' },
        { $ref: '#/$defs/SelectionScope' },
        { $ref: '#/$defs/OrganizationScope' },
      ],
    },
    DigestReference: {
      title: 'WisDigestReference',
      type: 'object',
      additionalProperties: false,
      required: ['algorithm', 'value'],
      properties: {
        algorithm: { $ref: '#/$defs/NonEmptyIdentifier' },
        value: { type: 'string', minLength: 8, maxLength: 1024 },
        canonicalization: { $ref: '#/$defs/NonEmptyIdentifier' },
      },
    },
    GenerationReference: {
      title: 'WisGenerationReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'generatedAt'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        generatedAt: { $ref: '#/$defs/Timestamp' },
        parents: {
          type: 'array',
          maxItems: 1e4,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        contentDigest: { $ref: '#/$defs/DigestReference' },
      },
    },
    ArtifactReference: {
      title: 'WisArtifactReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'generationId'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        generationId: { $ref: '#/$defs/NonEmptyIdentifier' },
        schemaId: { $ref: '#/$defs/NonEmptyIdentifier' },
        mediaType: { type: 'string', minLength: 1, maxLength: 256 },
        relativeLocator: { $ref: '#/$defs/PortableRelativeLocator' },
      },
    },
    EvidenceReference: {
      title: 'WisEvidenceReference',
      type: 'object',
      additionalProperties: false,
      required: ['id', 'sourceKind'],
      properties: {
        id: { $ref: '#/$defs/NonEmptyIdentifier' },
        sourceKind: { $ref: '#/$defs/NonEmptyIdentifier' },
        artifact: { $ref: '#/$defs/ArtifactReference' },
        relativeLocator: { $ref: '#/$defs/PortableRelativeLocator' },
        digest: { $ref: '#/$defs/DigestReference' },
        producer: { $ref: '#/$defs/ProducerReference' },
      },
    },
    RenewalReference: {
      title: 'WisRenewalReference',
      type: 'object',
      additionalProperties: false,
      required: ['operation'],
      properties: {
        operation: { $ref: '#/$defs/NonEmptyIdentifier' },
        scope: { $ref: '#/$defs/ScopeReference' },
      },
    },
    FreshnessSummary: {
      title: 'WisFreshnessSummary',
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: { enum: ['current', 'stale', 'unknown'] },
        evaluatedAt: { $ref: '#/$defs/Timestamp' },
        inputGenerations: {
          type: 'array',
          maxItems: 1e4,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        invalidationCauses: {
          type: 'array',
          maxItems: 1e3,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        renewal: { $ref: '#/$defs/RenewalReference' },
      },
    },
    Diagnostic: {
      title: 'WisDiagnostic',
      type: 'object',
      additionalProperties: false,
      required: ['code', 'severity', 'message', 'affectsStatus'],
      properties: {
        code: { $ref: '#/$defs/NonEmptyIdentifier' },
        severity: { enum: ['info', 'warning', 'error'] },
        message: { type: 'string', minLength: 1, maxLength: 16384 },
        affectsStatus: { type: 'boolean' },
        scope: { $ref: '#/$defs/ScopeReference' },
        entityId: { $ref: '#/$defs/NonEmptyIdentifier' },
        causes: { type: 'array', maxItems: 100, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
        evidence: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/EvidenceReference' } },
        renewal: { $ref: '#/$defs/RenewalReference' },
      },
    },
    UnknownRecord: {
      title: 'WisUnknownRecord',
      type: 'object',
      additionalProperties: false,
      required: ['code', 'subject', 'reason', 'affectsStatus'],
      properties: {
        code: { $ref: '#/$defs/NonEmptyIdentifier' },
        subject: { $ref: '#/$defs/NonEmptyIdentifier' },
        reason: { type: 'string', minLength: 1, maxLength: 16384 },
        affectsStatus: { type: 'boolean' },
        scope: { $ref: '#/$defs/ScopeReference' },
      },
    },
    OmissionRecord: {
      title: 'WisOmission',
      type: 'object',
      additionalProperties: false,
      required: ['code', 'reason', 'affectsStatus', 'recoverable'],
      properties: {
        code: { $ref: '#/$defs/NonEmptyIdentifier' },
        reason: { type: 'string', minLength: 1, maxLength: 16384 },
        affectsStatus: { type: 'boolean' },
        recoverable: { type: 'boolean' },
        scope: { $ref: '#/$defs/ScopeReference' },
        renewal: { $ref: '#/$defs/RenewalReference' },
      },
    },
    CompatibilitySummary: {
      title: 'WisCompatibilitySummary',
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: {
        status: { enum: ['compatible', 'conditionally-compatible', 'incompatible'] },
        baseline: { $ref: '#/$defs/ContractReference' },
        unsupportedCapabilities: {
          type: 'array',
          maxItems: 1e3,
          uniqueItems: true,
          items: { $ref: '#/$defs/NonEmptyIdentifier' },
        },
        losses: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
        migrations: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
      },
    },
    Extensions: {
      title: 'WisExtensions',
      type: 'object',
      maxProperties: 32,
      propertyNames: { pattern: '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$' },
      additionalProperties: true,
    },
  },
};
var func0 = Object.prototype.hasOwnProperty;
var func81 = require_ucs2length().default;
function validate24(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate24.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.version === void 0 || !func0.call(data, 'version')) && (missing0 = 'version'))
      ) {
        validate24.errors = [
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
          if (!(key0 === 'id' || key0 === 'version')) {
            validate24.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate24.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate24.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate24.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.version !== void 0 && func0.call(data, 'version')) {
              let data1 = data.version;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate24.errors = [
                      {
                        instancePath: instancePath + '/version',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate24.errors = [
                        {
                          instancePath: instancePath + '/version',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate24.errors = [
                    {
                      instancePath: instancePath + '/version',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate24.errors = [
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
  validate24.errors = vErrors;
  return errors === 0;
}
validate24.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var func27 = require_equal().default;
function validate26(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate26.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.version === void 0 || !func0.call(data, 'version')) && (missing0 = 'version'))
      ) {
        validate26.errors = [
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
          if (!(key0 === 'id' || key0 === 'version' || key0 === 'extensions')) {
            validate26.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate26.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate26.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate26.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.version !== void 0 && func0.call(data, 'version')) {
              let data1 = data.version;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate26.errors = [
                      {
                        instancePath: instancePath + '/version',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate26.errors = [
                        {
                          instancePath: instancePath + '/version',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate26.errors = [
                    {
                      instancePath: instancePath + '/version',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.extensions !== void 0 && func0.call(data, 'extensions')) {
                let data2 = data.extensions;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 128) {
                      validate26.errors = [
                        {
                          instancePath: instancePath + '/extensions',
                          schemaPath: '#/properties/extensions/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 128 },
                          message: 'must NOT have more than 128 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid3 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data3 = data2[i0];
                        const _errs10 = errors;
                        const _errs11 = errors;
                        if (errors === _errs11) {
                          if (typeof data3 === 'string') {
                            if (func81(data3) > 512) {
                              validate26.errors = [
                                {
                                  instancePath: instancePath + '/extensions/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 512 },
                                  message: 'must NOT have more than 512 characters',
                                },
                              ];
                              return false;
                            } else {
                              if (func81(data3) < 1) {
                                validate26.errors = [
                                  {
                                    instancePath: instancePath + '/extensions/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 1 },
                                    message: 'must NOT have fewer than 1 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate26.errors = [
                              {
                                instancePath: instancePath + '/extensions/' + i0,
                                schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid3 = _errs10 === errors;
                        if (!valid3) {
                          break;
                        }
                      }
                      if (valid3) {
                        let i1 = data2.length;
                        let j0;
                        if (i1 > 1) {
                          outer0: for (; i1--;) {
                            for (j0 = i1; j0--;) {
                              if (func27(data2[i1], data2[j0])) {
                                validate26.errors = [
                                  {
                                    instancePath: instancePath + '/extensions',
                                    schemaPath: '#/properties/extensions/uniqueItems',
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
                                break outer0;
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate26.errors = [
                      {
                        instancePath: instancePath + '/extensions',
                        schemaPath: '#/properties/extensions/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate26.errors = [
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
  validate26.errors = vErrors;
  return errors === 0;
}
validate26.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate29(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate29.evaluated;
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
        ((data.kind === void 0 || !func0.call(data, 'kind')) && (missing0 = 'kind')) ||
        ((data.projectIds === void 0 || !func0.call(data, 'projectIds')) &&
          (missing0 = 'projectIds'))
      ) {
        validate29.errors = [
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
          if (!(key0 === 'kind' || key0 === 'workspaceId' || key0 === 'projectIds')) {
            validate29.errors = [
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
          if (data.kind !== void 0 && func0.call(data, 'kind')) {
            const _errs2 = errors;
            if ('project' !== data.kind) {
              validate29.errors = [
                {
                  instancePath: instancePath + '/kind',
                  schemaPath: '#/properties/kind/const',
                  keyword: 'const',
                  params: { allowedValue: 'project' },
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
            if (data.workspaceId !== void 0 && func0.call(data, 'workspaceId')) {
              let data1 = data.workspaceId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate29.errors = [
                      {
                        instancePath: instancePath + '/workspaceId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate29.errors = [
                        {
                          instancePath: instancePath + '/workspaceId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate29.errors = [
                    {
                      instancePath: instancePath + '/workspaceId',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.projectIds !== void 0 && func0.call(data, 'projectIds')) {
                let data2 = data.projectIds;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate29.errors = [
                        {
                          instancePath: instancePath + '/projectIds',
                          schemaPath: '#/properties/projectIds/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      if (data2.length < 1) {
                        validate29.errors = [
                          {
                            instancePath: instancePath + '/projectIds',
                            schemaPath: '#/properties/projectIds/minItems',
                            keyword: 'minItems',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 items',
                          },
                        ];
                        return false;
                      } else {
                        var valid2 = true;
                        const len0 = data2.length;
                        for (let i0 = 0; i0 < len0; i0++) {
                          let data3 = data2[i0];
                          const _errs8 = errors;
                          const _errs9 = errors;
                          if (errors === _errs9) {
                            if (typeof data3 === 'string') {
                              if (func81(data3) > 512) {
                                validate29.errors = [
                                  {
                                    instancePath: instancePath + '/projectIds/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 512 },
                                    message: 'must NOT have more than 512 characters',
                                  },
                                ];
                                return false;
                              } else {
                                if (func81(data3) < 1) {
                                  validate29.errors = [
                                    {
                                      instancePath: instancePath + '/projectIds/' + i0,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 1 },
                                      message: 'must NOT have fewer than 1 characters',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            } else {
                              validate29.errors = [
                                {
                                  instancePath: instancePath + '/projectIds/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid2 = _errs8 === errors;
                          if (!valid2) {
                            break;
                          }
                        }
                        if (valid2) {
                          let i1 = data2.length;
                          let j0;
                          if (i1 > 1) {
                            outer0: for (; i1--;) {
                              for (j0 = i1; j0--;) {
                                if (func27(data2[i1], data2[j0])) {
                                  validate29.errors = [
                                    {
                                      instancePath: instancePath + '/projectIds',
                                      schemaPath: '#/properties/projectIds/uniqueItems',
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
                                  break outer0;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate29.errors = [
                      {
                        instancePath: instancePath + '/projectIds',
                        schemaPath: '#/properties/projectIds/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
                      },
                    ];
                    return false;
                  }
                }
                var valid0 = _errs6 === errors;
              } else {
                var valid0 = true;
              }
            }
          }
        }
      }
    } else {
      validate29.errors = [
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
  validate29.errors = vErrors;
  return errors === 0;
}
validate29.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate31(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate31.evaluated;
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
        ((data.kind === void 0 || !func0.call(data, 'kind')) && (missing0 = 'kind')) ||
        ((data.workspaceId === void 0 || !func0.call(data, 'workspaceId')) &&
          (missing0 = 'workspaceId'))
      ) {
        validate31.errors = [
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
          if (!(key0 === 'kind' || key0 === 'workspaceId')) {
            validate31.errors = [
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
          if (data.kind !== void 0 && func0.call(data, 'kind')) {
            const _errs2 = errors;
            if ('workspace' !== data.kind) {
              validate31.errors = [
                {
                  instancePath: instancePath + '/kind',
                  schemaPath: '#/properties/kind/const',
                  keyword: 'const',
                  params: { allowedValue: 'workspace' },
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
            if (data.workspaceId !== void 0 && func0.call(data, 'workspaceId')) {
              let data1 = data.workspaceId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate31.errors = [
                      {
                        instancePath: instancePath + '/workspaceId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate31.errors = [
                        {
                          instancePath: instancePath + '/workspaceId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate31.errors = [
                    {
                      instancePath: instancePath + '/workspaceId',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate31.errors = [
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
  validate31.errors = vErrors;
  return errors === 0;
}
validate31.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate33(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate33.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if ((data.kind === void 0 || !func0.call(data, 'kind')) && (missing0 = 'kind')) {
        validate33.errors = [
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
            key0 === 'kind' ||
            key0 === 'workspaceId' ||
            key0 === 'projectIds' ||
            key0 === 'entityIds' ||
            key0 === 'selector'
          )) {
            validate33.errors = [
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
          if (data.kind !== void 0 && func0.call(data, 'kind')) {
            const _errs2 = errors;
            if ('selection' !== data.kind) {
              validate33.errors = [
                {
                  instancePath: instancePath + '/kind',
                  schemaPath: '#/properties/kind/const',
                  keyword: 'const',
                  params: { allowedValue: 'selection' },
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
            if (data.workspaceId !== void 0 && func0.call(data, 'workspaceId')) {
              let data1 = data.workspaceId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate33.errors = [
                      {
                        instancePath: instancePath + '/workspaceId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate33.errors = [
                        {
                          instancePath: instancePath + '/workspaceId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate33.errors = [
                    {
                      instancePath: instancePath + '/workspaceId',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.projectIds !== void 0 && func0.call(data, 'projectIds')) {
                let data2 = data.projectIds;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate33.errors = [
                        {
                          instancePath: instancePath + '/projectIds',
                          schemaPath: '#/properties/projectIds/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      if (data2.length < 1) {
                        validate33.errors = [
                          {
                            instancePath: instancePath + '/projectIds',
                            schemaPath: '#/properties/projectIds/minItems',
                            keyword: 'minItems',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 items',
                          },
                        ];
                        return false;
                      } else {
                        var valid2 = true;
                        const len0 = data2.length;
                        for (let i0 = 0; i0 < len0; i0++) {
                          let data3 = data2[i0];
                          const _errs8 = errors;
                          const _errs9 = errors;
                          if (errors === _errs9) {
                            if (typeof data3 === 'string') {
                              if (func81(data3) > 512) {
                                validate33.errors = [
                                  {
                                    instancePath: instancePath + '/projectIds/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 512 },
                                    message: 'must NOT have more than 512 characters',
                                  },
                                ];
                                return false;
                              } else {
                                if (func81(data3) < 1) {
                                  validate33.errors = [
                                    {
                                      instancePath: instancePath + '/projectIds/' + i0,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 1 },
                                      message: 'must NOT have fewer than 1 characters',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            } else {
                              validate33.errors = [
                                {
                                  instancePath: instancePath + '/projectIds/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid2 = _errs8 === errors;
                          if (!valid2) {
                            break;
                          }
                        }
                        if (valid2) {
                          let i1 = data2.length;
                          let j0;
                          if (i1 > 1) {
                            outer0: for (; i1--;) {
                              for (j0 = i1; j0--;) {
                                if (func27(data2[i1], data2[j0])) {
                                  validate33.errors = [
                                    {
                                      instancePath: instancePath + '/projectIds',
                                      schemaPath: '#/properties/projectIds/uniqueItems',
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
                                  break outer0;
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate33.errors = [
                      {
                        instancePath: instancePath + '/projectIds',
                        schemaPath: '#/properties/projectIds/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
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
                if (data.entityIds !== void 0 && func0.call(data, 'entityIds')) {
                  let data4 = data.entityIds;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (Array.isArray(data4)) {
                      if (data4.length > 1e4) {
                        validate33.errors = [
                          {
                            instancePath: instancePath + '/entityIds',
                            schemaPath: '#/properties/entityIds/maxItems',
                            keyword: 'maxItems',
                            params: { limit: 1e4 },
                            message: 'must NOT have more than 10000 items',
                          },
                        ];
                        return false;
                      } else {
                        if (data4.length < 1) {
                          validate33.errors = [
                            {
                              instancePath: instancePath + '/entityIds',
                              schemaPath: '#/properties/entityIds/minItems',
                              keyword: 'minItems',
                              params: { limit: 1 },
                              message: 'must NOT have fewer than 1 items',
                            },
                          ];
                          return false;
                        } else {
                          var valid5 = true;
                          const len1 = data4.length;
                          for (let i2 = 0; i2 < len1; i2++) {
                            let data5 = data4[i2];
                            const _errs13 = errors;
                            const _errs14 = errors;
                            if (errors === _errs14) {
                              if (typeof data5 === 'string') {
                                if (func81(data5) > 512) {
                                  validate33.errors = [
                                    {
                                      instancePath: instancePath + '/entityIds/' + i2,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                      keyword: 'maxLength',
                                      params: { limit: 512 },
                                      message: 'must NOT have more than 512 characters',
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (func81(data5) < 1) {
                                    validate33.errors = [
                                      {
                                        instancePath: instancePath + '/entityIds/' + i2,
                                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                        keyword: 'minLength',
                                        params: { limit: 1 },
                                        message: 'must NOT have fewer than 1 characters',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              } else {
                                validate33.errors = [
                                  {
                                    instancePath: instancePath + '/entityIds/' + i2,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                    keyword: 'type',
                                    params: { type: 'string' },
                                    message: 'must be string',
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid5 = _errs13 === errors;
                            if (!valid5) {
                              break;
                            }
                          }
                          if (valid5) {
                            let i3 = data4.length;
                            let j1;
                            if (i3 > 1) {
                              outer1: for (; i3--;) {
                                for (j1 = i3; j1--;) {
                                  if (func27(data4[i3], data4[j1])) {
                                    validate33.errors = [
                                      {
                                        instancePath: instancePath + '/entityIds',
                                        schemaPath: '#/properties/entityIds/uniqueItems',
                                        keyword: 'uniqueItems',
                                        params: { i: i3, j: j1 },
                                        message:
                                          'must NOT have duplicate items (items ## ' +
                                          j1 +
                                          ' and ' +
                                          i3 +
                                          ' are identical)',
                                      },
                                    ];
                                    return false;
                                    break outer1;
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    } else {
                      validate33.errors = [
                        {
                          instancePath: instancePath + '/entityIds',
                          schemaPath: '#/properties/entityIds/type',
                          keyword: 'type',
                          params: { type: 'array' },
                          message: 'must be array',
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
                  if (data.selector !== void 0 && func0.call(data, 'selector')) {
                    let data6 = data.selector;
                    const _errs16 = errors;
                    if (errors === _errs16) {
                      if (typeof data6 === 'string') {
                        if (func81(data6) > 4096) {
                          validate33.errors = [
                            {
                              instancePath: instancePath + '/selector',
                              schemaPath: '#/properties/selector/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 4096 },
                              message: 'must NOT have more than 4096 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func81(data6) < 1) {
                            validate33.errors = [
                              {
                                instancePath: instancePath + '/selector',
                                schemaPath: '#/properties/selector/minLength',
                                keyword: 'minLength',
                                params: { limit: 1 },
                                message: 'must NOT have fewer than 1 characters',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate33.errors = [
                          {
                            instancePath: instancePath + '/selector',
                            schemaPath: '#/properties/selector/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs16 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate33.errors = [
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
  validate33.errors = vErrors;
  return errors === 0;
}
validate33.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate35(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate35.evaluated;
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
        ((data.kind === void 0 || !func0.call(data, 'kind')) && (missing0 = 'kind')) ||
        ((data.organizationId === void 0 || !func0.call(data, 'organizationId')) &&
          (missing0 = 'organizationId'))
      ) {
        validate35.errors = [
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
          if (!(key0 === 'kind' || key0 === 'organizationId' || key0 === 'workspaceId')) {
            validate35.errors = [
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
          if (data.kind !== void 0 && func0.call(data, 'kind')) {
            const _errs2 = errors;
            if ('organization' !== data.kind) {
              validate35.errors = [
                {
                  instancePath: instancePath + '/kind',
                  schemaPath: '#/properties/kind/const',
                  keyword: 'const',
                  params: { allowedValue: 'organization' },
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
            if (data.organizationId !== void 0 && func0.call(data, 'organizationId')) {
              let data1 = data.organizationId;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate35.errors = [
                      {
                        instancePath: instancePath + '/organizationId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate35.errors = [
                        {
                          instancePath: instancePath + '/organizationId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate35.errors = [
                    {
                      instancePath: instancePath + '/organizationId',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.workspaceId !== void 0 && func0.call(data, 'workspaceId')) {
                let data2 = data.workspaceId;
                const _errs6 = errors;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 512) {
                      validate35.errors = [
                        {
                          instancePath: instancePath + '/workspaceId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 512 },
                          message: 'must NOT have more than 512 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate35.errors = [
                          {
                            instancePath: instancePath + '/workspaceId',
                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate35.errors = [
                      {
                        instancePath: instancePath + '/workspaceId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            }
          }
        }
      }
    } else {
      validate35.errors = [
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
  validate35.errors = vErrors;
  return errors === 0;
}
validate35.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate28(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate28.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  const _errs0 = errors;
  let valid0 = false;
  let passing0 = null;
  const _errs1 = errors;
  if (
    !validate29(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate29.errors : vErrors.concat(validate29.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs1 === errors;
  if (_valid0) {
    valid0 = true;
    passing0 = 0;
    var props0 = true;
  }
  const _errs2 = errors;
  if (
    !validate31(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
  ) {
    vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
    errors = vErrors.length;
  }
  var _valid0 = _errs2 === errors;
  if (_valid0 && valid0) {
    valid0 = false;
    passing0 = [passing0, 1];
  } else {
    if (_valid0) {
      valid0 = true;
      passing0 = 1;
      if (props0 !== true) {
        props0 = true;
      }
    }
    const _errs3 = errors;
    if (
      !validate33(data, { instancePath, parentData, parentDataProperty, rootData, dynamicAnchors })
    ) {
      vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors);
      errors = vErrors.length;
    }
    var _valid0 = _errs3 === errors;
    if (_valid0 && valid0) {
      valid0 = false;
      passing0 = [passing0, 2];
    } else {
      if (_valid0) {
        valid0 = true;
        passing0 = 2;
        if (props0 !== true) {
          props0 = true;
        }
      }
      const _errs4 = errors;
      if (
        !validate35(data, {
          instancePath,
          parentData,
          parentDataProperty,
          rootData,
          dynamicAnchors,
        })
      ) {
        vErrors = vErrors === null ? validate35.errors : vErrors.concat(validate35.errors);
        errors = vErrors.length;
      }
      var _valid0 = _errs4 === errors;
      if (_valid0 && valid0) {
        valid0 = false;
        passing0 = [passing0, 3];
      } else {
        if (_valid0) {
          valid0 = true;
          passing0 = 3;
          if (props0 !== true) {
            props0 = true;
          }
        }
      }
    }
  }
  if (!valid0) {
    const err0 = {
      instancePath,
      schemaPath: '#/oneOf',
      keyword: 'oneOf',
      params: { passingSchemas: passing0 },
      message: 'must match exactly one schema in oneOf',
    };
    if (vErrors === null) {
      vErrors = [err0];
    } else {
      vErrors.push(err0);
    }
    errors++;
    validate28.errors = vErrors;
    return false;
  } else {
    errors = _errs0;
    if (vErrors !== null) {
      if (_errs0) {
        vErrors.length = _errs0;
      } else {
        vErrors = null;
      }
    }
  }
  validate28.errors = vErrors;
  evaluated0.props = props0;
  return errors === 0;
}
validate28.evaluated = { dynamicProps: true, dynamicItems: false };
var pattern14 = new RegExp(
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$',
  'u'
);
function validate39(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate39.evaluated;
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
        ((data.algorithm === void 0 || !func0.call(data, 'algorithm')) &&
          (missing0 = 'algorithm')) ||
        ((data.value === void 0 || !func0.call(data, 'value')) && (missing0 = 'value'))
      ) {
        validate39.errors = [
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
          if (!(key0 === 'algorithm' || key0 === 'value' || key0 === 'canonicalization')) {
            validate39.errors = [
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
          if (data.algorithm !== void 0 && func0.call(data, 'algorithm')) {
            let data0 = data.algorithm;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate39.errors = [
                    {
                      instancePath: instancePath + '/algorithm',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate39.errors = [
                      {
                        instancePath: instancePath + '/algorithm',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate39.errors = [
                  {
                    instancePath: instancePath + '/algorithm',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.value !== void 0 && func0.call(data, 'value')) {
              let data1 = data.value;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 1024) {
                    validate39.errors = [
                      {
                        instancePath: instancePath + '/value',
                        schemaPath: '#/properties/value/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 1024 },
                        message: 'must NOT have more than 1024 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 8) {
                      validate39.errors = [
                        {
                          instancePath: instancePath + '/value',
                          schemaPath: '#/properties/value/minLength',
                          keyword: 'minLength',
                          params: { limit: 8 },
                          message: 'must NOT have fewer than 8 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate39.errors = [
                    {
                      instancePath: instancePath + '/value',
                      schemaPath: '#/properties/value/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.canonicalization !== void 0 && func0.call(data, 'canonicalization')) {
                let data2 = data.canonicalization;
                const _errs7 = errors;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 512) {
                      validate39.errors = [
                        {
                          instancePath: instancePath + '/canonicalization',
                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 512 },
                          message: 'must NOT have more than 512 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate39.errors = [
                          {
                            instancePath: instancePath + '/canonicalization',
                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate39.errors = [
                      {
                        instancePath: instancePath + '/canonicalization',
                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
                        keyword: 'type',
                        params: { type: 'string' },
                        message: 'must be string',
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
    } else {
      validate39.errors = [
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
  validate39.errors = vErrors;
  return errors === 0;
}
validate39.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate38(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate38.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.generatedAt === void 0 || !func0.call(data, 'generatedAt')) &&
          (missing0 = 'generatedAt'))
      ) {
        validate38.errors = [
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
            key0 === 'id' ||
            key0 === 'generatedAt' ||
            key0 === 'parents' ||
            key0 === 'contentDigest'
          )) {
            validate38.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate38.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate38.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate38.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.generatedAt !== void 0 && func0.call(data, 'generatedAt')) {
              let data1 = data.generatedAt;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (!pattern14.test(data1)) {
                    validate38.errors = [
                      {
                        instancePath: instancePath + '/generatedAt',
                        schemaPath: '#/$defs/Timestamp/pattern',
                        keyword: 'pattern',
                        params: {
                          pattern:
                            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$',
                        },
                        message:
                          'must match pattern "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate38.errors = [
                    {
                      instancePath: instancePath + '/generatedAt',
                      schemaPath: '#/$defs/Timestamp/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.parents !== void 0 && func0.call(data, 'parents')) {
                let data2 = data.parents;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate38.errors = [
                        {
                          instancePath: instancePath + '/parents',
                          schemaPath: '#/properties/parents/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid3 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data3 = data2[i0];
                        const _errs10 = errors;
                        const _errs11 = errors;
                        if (errors === _errs11) {
                          if (typeof data3 === 'string') {
                            if (func81(data3) > 512) {
                              validate38.errors = [
                                {
                                  instancePath: instancePath + '/parents/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 512 },
                                  message: 'must NOT have more than 512 characters',
                                },
                              ];
                              return false;
                            } else {
                              if (func81(data3) < 1) {
                                validate38.errors = [
                                  {
                                    instancePath: instancePath + '/parents/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 1 },
                                    message: 'must NOT have fewer than 1 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate38.errors = [
                              {
                                instancePath: instancePath + '/parents/' + i0,
                                schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid3 = _errs10 === errors;
                        if (!valid3) {
                          break;
                        }
                      }
                      if (valid3) {
                        let i1 = data2.length;
                        let j0;
                        if (i1 > 1) {
                          outer0: for (; i1--;) {
                            for (j0 = i1; j0--;) {
                              if (func27(data2[i1], data2[j0])) {
                                validate38.errors = [
                                  {
                                    instancePath: instancePath + '/parents',
                                    schemaPath: '#/properties/parents/uniqueItems',
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
                                break outer0;
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate38.errors = [
                      {
                        instancePath: instancePath + '/parents',
                        schemaPath: '#/properties/parents/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
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
                if (data.contentDigest !== void 0 && func0.call(data, 'contentDigest')) {
                  const _errs13 = errors;
                  if (
                    !validate39(data.contentDigest, {
                      instancePath: instancePath + '/contentDigest',
                      parentData: data,
                      parentDataProperty: 'contentDigest',
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate39.errors : vErrors.concat(validate39.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs13 === errors;
                } else {
                  var valid0 = true;
                }
              }
            }
          }
        }
      }
    } else {
      validate38.errors = [
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
  validate38.errors = vErrors;
  return errors === 0;
}
validate38.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate43(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate43.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.generationId === void 0 || !func0.call(data, 'generationId')) &&
          (missing0 = 'generationId'))
      ) {
        validate43.errors = [
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
            key0 === 'id' ||
            key0 === 'generationId' ||
            key0 === 'schemaId' ||
            key0 === 'mediaType' ||
            key0 === 'relativeLocator'
          )) {
            validate43.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate43.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate43.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate43.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.generationId !== void 0 && func0.call(data, 'generationId')) {
              let data1 = data.generationId;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate43.errors = [
                      {
                        instancePath: instancePath + '/generationId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate43.errors = [
                        {
                          instancePath: instancePath + '/generationId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate43.errors = [
                    {
                      instancePath: instancePath + '/generationId',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.schemaId !== void 0 && func0.call(data, 'schemaId')) {
                let data2 = data.schemaId;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 512) {
                      validate43.errors = [
                        {
                          instancePath: instancePath + '/schemaId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 512 },
                          message: 'must NOT have more than 512 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate43.errors = [
                          {
                            instancePath: instancePath + '/schemaId',
                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate43.errors = [
                      {
                        instancePath: instancePath + '/schemaId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
                if (data.mediaType !== void 0 && func0.call(data, 'mediaType')) {
                  let data3 = data.mediaType;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (typeof data3 === 'string') {
                      if (func81(data3) > 256) {
                        validate43.errors = [
                          {
                            instancePath: instancePath + '/mediaType',
                            schemaPath: '#/properties/mediaType/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 256 },
                            message: 'must NOT have more than 256 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func81(data3) < 1) {
                          validate43.errors = [
                            {
                              instancePath: instancePath + '/mediaType',
                              schemaPath: '#/properties/mediaType/minLength',
                              keyword: 'minLength',
                              params: { limit: 1 },
                              message: 'must NOT have fewer than 1 characters',
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate43.errors = [
                        {
                          instancePath: instancePath + '/mediaType',
                          schemaPath: '#/properties/mediaType/type',
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
                  if (data.relativeLocator !== void 0 && func0.call(data, 'relativeLocator')) {
                    let data4 = data.relativeLocator;
                    const _errs13 = errors;
                    const _errs14 = errors;
                    if (errors === _errs14) {
                      if (typeof data4 === 'string') {
                        if (func81(data4) > 4096) {
                          validate43.errors = [
                            {
                              instancePath: instancePath + '/relativeLocator',
                              schemaPath: '#/$defs/PortableRelativeLocator/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 4096 },
                              message: 'must NOT have more than 4096 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func81(data4) < 1) {
                            validate43.errors = [
                              {
                                instancePath: instancePath + '/relativeLocator',
                                schemaPath: '#/$defs/PortableRelativeLocator/minLength',
                                keyword: 'minLength',
                                params: { limit: 1 },
                                message: 'must NOT have fewer than 1 characters',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate43.errors = [
                          {
                            instancePath: instancePath + '/relativeLocator',
                            schemaPath: '#/$defs/PortableRelativeLocator/type',
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
                }
              }
            }
          }
        }
      }
    } else {
      validate43.errors = [
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
  validate43.errors = vErrors;
  return errors === 0;
}
validate43.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate42(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate42.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.sourceKind === void 0 || !func0.call(data, 'sourceKind')) &&
          (missing0 = 'sourceKind'))
      ) {
        validate42.errors = [
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
            key0 === 'id' ||
            key0 === 'sourceKind' ||
            key0 === 'artifact' ||
            key0 === 'relativeLocator' ||
            key0 === 'digest' ||
            key0 === 'producer'
          )) {
            validate42.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate42.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate42.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate42.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.sourceKind !== void 0 && func0.call(data, 'sourceKind')) {
              let data1 = data.sourceKind;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate42.errors = [
                      {
                        instancePath: instancePath + '/sourceKind',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate42.errors = [
                        {
                          instancePath: instancePath + '/sourceKind',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate42.errors = [
                    {
                      instancePath: instancePath + '/sourceKind',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.artifact !== void 0 && func0.call(data, 'artifact')) {
                const _errs8 = errors;
                if (
                  !validate43(data.artifact, {
                    instancePath: instancePath + '/artifact',
                    parentData: data,
                    parentDataProperty: 'artifact',
                    rootData,
                    dynamicAnchors,
                  })
                ) {
                  vErrors =
                    vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
                  errors = vErrors.length;
                }
                var valid0 = _errs8 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.relativeLocator !== void 0 && func0.call(data, 'relativeLocator')) {
                  let data3 = data.relativeLocator;
                  const _errs9 = errors;
                  const _errs10 = errors;
                  if (errors === _errs10) {
                    if (typeof data3 === 'string') {
                      if (func81(data3) > 4096) {
                        validate42.errors = [
                          {
                            instancePath: instancePath + '/relativeLocator',
                            schemaPath: '#/$defs/PortableRelativeLocator/maxLength',
                            keyword: 'maxLength',
                            params: { limit: 4096 },
                            message: 'must NOT have more than 4096 characters',
                          },
                        ];
                        return false;
                      } else {
                        if (func81(data3) < 1) {
                          validate42.errors = [
                            {
                              instancePath: instancePath + '/relativeLocator',
                              schemaPath: '#/$defs/PortableRelativeLocator/minLength',
                              keyword: 'minLength',
                              params: { limit: 1 },
                              message: 'must NOT have fewer than 1 characters',
                            },
                          ];
                          return false;
                        }
                      }
                    } else {
                      validate42.errors = [
                        {
                          instancePath: instancePath + '/relativeLocator',
                          schemaPath: '#/$defs/PortableRelativeLocator/type',
                          keyword: 'type',
                          params: { type: 'string' },
                          message: 'must be string',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.digest !== void 0 && func0.call(data, 'digest')) {
                    const _errs12 = errors;
                    if (
                      !validate39(data.digest, {
                        instancePath: instancePath + '/digest',
                        parentData: data,
                        parentDataProperty: 'digest',
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate39.errors : vErrors.concat(validate39.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.producer !== void 0 && func0.call(data, 'producer')) {
                      const _errs13 = errors;
                      if (
                        !validate26(data.producer, {
                          instancePath: instancePath + '/producer',
                          parentData: data,
                          parentDataProperty: 'producer',
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate26.errors : vErrors.concat(validate26.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs13 === errors;
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
    } else {
      validate42.errors = [
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
  validate42.errors = vErrors;
  return errors === 0;
}
validate42.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var schema77 = {
  title: 'WisFreshnessSummary',
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { enum: ['current', 'stale', 'unknown'] },
    evaluatedAt: { $ref: '#/$defs/Timestamp' },
    inputGenerations: {
      type: 'array',
      maxItems: 1e4,
      uniqueItems: true,
      items: { $ref: '#/$defs/NonEmptyIdentifier' },
    },
    invalidationCauses: {
      type: 'array',
      maxItems: 1e3,
      uniqueItems: true,
      items: { $ref: '#/$defs/NonEmptyIdentifier' },
    },
    renewal: { $ref: '#/$defs/RenewalReference' },
  },
};
function validate49(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate49.evaluated;
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
        (data.operation === void 0 || !func0.call(data, 'operation')) &&
        (missing0 = 'operation')
      ) {
        validate49.errors = [
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
          if (!(key0 === 'operation' || key0 === 'scope')) {
            validate49.errors = [
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
          if (data.operation !== void 0 && func0.call(data, 'operation')) {
            let data0 = data.operation;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate49.errors = [
                    {
                      instancePath: instancePath + '/operation',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate49.errors = [
                      {
                        instancePath: instancePath + '/operation',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate49.errors = [
                  {
                    instancePath: instancePath + '/operation',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.scope !== void 0 && func0.call(data, 'scope')) {
              const _errs5 = errors;
              if (
                !validate28(data.scope, {
                  instancePath: instancePath + '/scope',
                  parentData: data,
                  parentDataProperty: 'scope',
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
          }
        }
      }
    } else {
      validate49.errors = [
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
  validate49.errors = vErrors;
  return errors === 0;
}
validate49.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate48(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate48.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if ((data.status === void 0 || !func0.call(data, 'status')) && (missing0 = 'status')) {
        validate48.errors = [
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
            key0 === 'status' ||
            key0 === 'evaluatedAt' ||
            key0 === 'inputGenerations' ||
            key0 === 'invalidationCauses' ||
            key0 === 'renewal'
          )) {
            validate48.errors = [
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
          if (data.status !== void 0 && func0.call(data, 'status')) {
            let data0 = data.status;
            const _errs2 = errors;
            if (!(data0 === 'current' || data0 === 'stale' || data0 === 'unknown')) {
              validate48.errors = [
                {
                  instancePath: instancePath + '/status',
                  schemaPath: '#/properties/status/enum',
                  keyword: 'enum',
                  params: { allowedValues: schema77.properties.status.enum },
                  message: 'must be equal to one of the allowed values',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.evaluatedAt !== void 0 && func0.call(data, 'evaluatedAt')) {
              let data1 = data.evaluatedAt;
              const _errs3 = errors;
              const _errs4 = errors;
              if (errors === _errs4) {
                if (typeof data1 === 'string') {
                  if (!pattern14.test(data1)) {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/evaluatedAt',
                        schemaPath: '#/$defs/Timestamp/pattern',
                        keyword: 'pattern',
                        params: {
                          pattern:
                            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$',
                        },
                        message:
                          'must match pattern "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$"',
                      },
                    ];
                    return false;
                  }
                } else {
                  validate48.errors = [
                    {
                      instancePath: instancePath + '/evaluatedAt',
                      schemaPath: '#/$defs/Timestamp/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.inputGenerations !== void 0 && func0.call(data, 'inputGenerations')) {
                let data2 = data.inputGenerations;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e4) {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/inputGenerations',
                          schemaPath: '#/properties/inputGenerations/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e4 },
                          message: 'must NOT have more than 10000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid2 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data3 = data2[i0];
                        const _errs8 = errors;
                        const _errs9 = errors;
                        if (errors === _errs9) {
                          if (typeof data3 === 'string') {
                            if (func81(data3) > 512) {
                              validate48.errors = [
                                {
                                  instancePath: instancePath + '/inputGenerations/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 512 },
                                  message: 'must NOT have more than 512 characters',
                                },
                              ];
                              return false;
                            } else {
                              if (func81(data3) < 1) {
                                validate48.errors = [
                                  {
                                    instancePath: instancePath + '/inputGenerations/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 1 },
                                    message: 'must NOT have fewer than 1 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate48.errors = [
                              {
                                instancePath: instancePath + '/inputGenerations/' + i0,
                                schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid2 = _errs8 === errors;
                        if (!valid2) {
                          break;
                        }
                      }
                      if (valid2) {
                        let i1 = data2.length;
                        let j0;
                        if (i1 > 1) {
                          outer0: for (; i1--;) {
                            for (j0 = i1; j0--;) {
                              if (func27(data2[i1], data2[j0])) {
                                validate48.errors = [
                                  {
                                    instancePath: instancePath + '/inputGenerations',
                                    schemaPath: '#/properties/inputGenerations/uniqueItems',
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
                                break outer0;
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate48.errors = [
                      {
                        instancePath: instancePath + '/inputGenerations',
                        schemaPath: '#/properties/inputGenerations/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
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
                if (data.invalidationCauses !== void 0 && func0.call(data, 'invalidationCauses')) {
                  let data4 = data.invalidationCauses;
                  const _errs11 = errors;
                  if (errors === _errs11) {
                    if (Array.isArray(data4)) {
                      if (data4.length > 1e3) {
                        validate48.errors = [
                          {
                            instancePath: instancePath + '/invalidationCauses',
                            schemaPath: '#/properties/invalidationCauses/maxItems',
                            keyword: 'maxItems',
                            params: { limit: 1e3 },
                            message: 'must NOT have more than 1000 items',
                          },
                        ];
                        return false;
                      } else {
                        var valid5 = true;
                        const len1 = data4.length;
                        for (let i2 = 0; i2 < len1; i2++) {
                          let data5 = data4[i2];
                          const _errs13 = errors;
                          const _errs14 = errors;
                          if (errors === _errs14) {
                            if (typeof data5 === 'string') {
                              if (func81(data5) > 512) {
                                validate48.errors = [
                                  {
                                    instancePath: instancePath + '/invalidationCauses/' + i2,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 512 },
                                    message: 'must NOT have more than 512 characters',
                                  },
                                ];
                                return false;
                              } else {
                                if (func81(data5) < 1) {
                                  validate48.errors = [
                                    {
                                      instancePath: instancePath + '/invalidationCauses/' + i2,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 1 },
                                      message: 'must NOT have fewer than 1 characters',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            } else {
                              validate48.errors = [
                                {
                                  instancePath: instancePath + '/invalidationCauses/' + i2,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid5 = _errs13 === errors;
                          if (!valid5) {
                            break;
                          }
                        }
                        if (valid5) {
                          let i3 = data4.length;
                          let j1;
                          if (i3 > 1) {
                            outer1: for (; i3--;) {
                              for (j1 = i3; j1--;) {
                                if (func27(data4[i3], data4[j1])) {
                                  validate48.errors = [
                                    {
                                      instancePath: instancePath + '/invalidationCauses',
                                      schemaPath: '#/properties/invalidationCauses/uniqueItems',
                                      keyword: 'uniqueItems',
                                      params: { i: i3, j: j1 },
                                      message:
                                        'must NOT have duplicate items (items ## ' +
                                        j1 +
                                        ' and ' +
                                        i3 +
                                        ' are identical)',
                                    },
                                  ];
                                  return false;
                                  break outer1;
                                }
                              }
                            }
                          }
                        }
                      }
                    } else {
                      validate48.errors = [
                        {
                          instancePath: instancePath + '/invalidationCauses',
                          schemaPath: '#/properties/invalidationCauses/type',
                          keyword: 'type',
                          params: { type: 'array' },
                          message: 'must be array',
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
                  if (data.renewal !== void 0 && func0.call(data, 'renewal')) {
                    const _errs16 = errors;
                    if (
                      !validate49(data.renewal, {
                        instancePath: instancePath + '/renewal',
                        parentData: data,
                        parentDataProperty: 'renewal',
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate49.errors : vErrors.concat(validate49.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs16 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate48.errors = [
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
  validate48.errors = vErrors;
  return errors === 0;
}
validate48.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate53(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate53.evaluated;
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
        ((data.code === void 0 || !func0.call(data, 'code')) && (missing0 = 'code')) ||
        ((data.subject === void 0 || !func0.call(data, 'subject')) && (missing0 = 'subject')) ||
        ((data.reason === void 0 || !func0.call(data, 'reason')) && (missing0 = 'reason')) ||
        ((data.affectsStatus === void 0 || !func0.call(data, 'affectsStatus')) &&
          (missing0 = 'affectsStatus'))
      ) {
        validate53.errors = [
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
            key0 === 'code' ||
            key0 === 'subject' ||
            key0 === 'reason' ||
            key0 === 'affectsStatus' ||
            key0 === 'scope'
          )) {
            validate53.errors = [
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
          if (data.code !== void 0 && func0.call(data, 'code')) {
            let data0 = data.code;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate53.errors = [
                    {
                      instancePath: instancePath + '/code',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate53.errors = [
                      {
                        instancePath: instancePath + '/code',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate53.errors = [
                  {
                    instancePath: instancePath + '/code',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.subject !== void 0 && func0.call(data, 'subject')) {
              let data1 = data.subject;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate53.errors = [
                      {
                        instancePath: instancePath + '/subject',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate53.errors = [
                        {
                          instancePath: instancePath + '/subject',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate53.errors = [
                    {
                      instancePath: instancePath + '/subject',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.reason !== void 0 && func0.call(data, 'reason')) {
                let data2 = data.reason;
                const _errs8 = errors;
                if (errors === _errs8) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 16384) {
                      validate53.errors = [
                        {
                          instancePath: instancePath + '/reason',
                          schemaPath: '#/properties/reason/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 16384 },
                          message: 'must NOT have more than 16384 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate53.errors = [
                          {
                            instancePath: instancePath + '/reason',
                            schemaPath: '#/properties/reason/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate53.errors = [
                      {
                        instancePath: instancePath + '/reason',
                        schemaPath: '#/properties/reason/type',
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
                if (data.affectsStatus !== void 0 && func0.call(data, 'affectsStatus')) {
                  const _errs10 = errors;
                  if (typeof data.affectsStatus !== 'boolean') {
                    validate53.errors = [
                      {
                        instancePath: instancePath + '/affectsStatus',
                        schemaPath: '#/properties/affectsStatus/type',
                        keyword: 'type',
                        params: { type: 'boolean' },
                        message: 'must be boolean',
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs10 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.scope !== void 0 && func0.call(data, 'scope')) {
                    const _errs12 = errors;
                    if (
                      !validate28(data.scope, {
                        instancePath: instancePath + '/scope',
                        parentData: data,
                        parentDataProperty: 'scope',
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs12 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate53.errors = [
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
  validate53.errors = vErrors;
  return errors === 0;
}
validate53.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate56(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate56.evaluated;
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
        ((data.code === void 0 || !func0.call(data, 'code')) && (missing0 = 'code')) ||
        ((data.reason === void 0 || !func0.call(data, 'reason')) && (missing0 = 'reason')) ||
        ((data.affectsStatus === void 0 || !func0.call(data, 'affectsStatus')) &&
          (missing0 = 'affectsStatus')) ||
        ((data.recoverable === void 0 || !func0.call(data, 'recoverable')) &&
          (missing0 = 'recoverable'))
      ) {
        validate56.errors = [
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
            key0 === 'code' ||
            key0 === 'reason' ||
            key0 === 'affectsStatus' ||
            key0 === 'recoverable' ||
            key0 === 'scope' ||
            key0 === 'renewal'
          )) {
            validate56.errors = [
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
          if (data.code !== void 0 && func0.call(data, 'code')) {
            let data0 = data.code;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate56.errors = [
                    {
                      instancePath: instancePath + '/code',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate56.errors = [
                      {
                        instancePath: instancePath + '/code',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate56.errors = [
                  {
                    instancePath: instancePath + '/code',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.reason !== void 0 && func0.call(data, 'reason')) {
              let data1 = data.reason;
              const _errs5 = errors;
              if (errors === _errs5) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 16384) {
                    validate56.errors = [
                      {
                        instancePath: instancePath + '/reason',
                        schemaPath: '#/properties/reason/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 16384 },
                        message: 'must NOT have more than 16384 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate56.errors = [
                        {
                          instancePath: instancePath + '/reason',
                          schemaPath: '#/properties/reason/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate56.errors = [
                    {
                      instancePath: instancePath + '/reason',
                      schemaPath: '#/properties/reason/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.affectsStatus !== void 0 && func0.call(data, 'affectsStatus')) {
                const _errs7 = errors;
                if (typeof data.affectsStatus !== 'boolean') {
                  validate56.errors = [
                    {
                      instancePath: instancePath + '/affectsStatus',
                      schemaPath: '#/properties/affectsStatus/type',
                      keyword: 'type',
                      params: { type: 'boolean' },
                      message: 'must be boolean',
                    },
                  ];
                  return false;
                }
                var valid0 = _errs7 === errors;
              } else {
                var valid0 = true;
              }
              if (valid0) {
                if (data.recoverable !== void 0 && func0.call(data, 'recoverable')) {
                  const _errs9 = errors;
                  if (typeof data.recoverable !== 'boolean') {
                    validate56.errors = [
                      {
                        instancePath: instancePath + '/recoverable',
                        schemaPath: '#/properties/recoverable/type',
                        keyword: 'type',
                        params: { type: 'boolean' },
                        message: 'must be boolean',
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.scope !== void 0 && func0.call(data, 'scope')) {
                    const _errs11 = errors;
                    if (
                      !validate28(data.scope, {
                        instancePath: instancePath + '/scope',
                        parentData: data,
                        parentDataProperty: 'scope',
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs11 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.renewal !== void 0 && func0.call(data, 'renewal')) {
                      const _errs12 = errors;
                      if (
                        !validate49(data.renewal, {
                          instancePath: instancePath + '/renewal',
                          parentData: data,
                          parentDataProperty: 'renewal',
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate49.errors : vErrors.concat(validate49.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs12 === errors;
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
    } else {
      validate56.errors = [
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
  validate56.errors = vErrors;
  return errors === 0;
}
validate56.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var schema88 = {
  title: 'WisDiagnostic',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'severity', 'message', 'affectsStatus'],
  properties: {
    code: { $ref: '#/$defs/NonEmptyIdentifier' },
    severity: { enum: ['info', 'warning', 'error'] },
    message: { type: 'string', minLength: 1, maxLength: 16384 },
    affectsStatus: { type: 'boolean' },
    scope: { $ref: '#/$defs/ScopeReference' },
    entityId: { $ref: '#/$defs/NonEmptyIdentifier' },
    causes: { type: 'array', maxItems: 100, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
    evidence: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/EvidenceReference' } },
    renewal: { $ref: '#/$defs/RenewalReference' },
  },
};
function validate60(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate60.evaluated;
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
        ((data.code === void 0 || !func0.call(data, 'code')) && (missing0 = 'code')) ||
        ((data.severity === void 0 || !func0.call(data, 'severity')) && (missing0 = 'severity')) ||
        ((data.message === void 0 || !func0.call(data, 'message')) && (missing0 = 'message')) ||
        ((data.affectsStatus === void 0 || !func0.call(data, 'affectsStatus')) &&
          (missing0 = 'affectsStatus'))
      ) {
        validate60.errors = [
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
          if (!func0.call(schema88.properties, key0)) {
            validate60.errors = [
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
          if (data.code !== void 0 && func0.call(data, 'code')) {
            let data0 = data.code;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate60.errors = [
                    {
                      instancePath: instancePath + '/code',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate60.errors = [
                      {
                        instancePath: instancePath + '/code',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate60.errors = [
                  {
                    instancePath: instancePath + '/code',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.severity !== void 0 && func0.call(data, 'severity')) {
              let data1 = data.severity;
              const _errs5 = errors;
              if (!(data1 === 'info' || data1 === 'warning' || data1 === 'error')) {
                validate60.errors = [
                  {
                    instancePath: instancePath + '/severity',
                    schemaPath: '#/properties/severity/enum',
                    keyword: 'enum',
                    params: { allowedValues: schema88.properties.severity.enum },
                    message: 'must be equal to one of the allowed values',
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.message !== void 0 && func0.call(data, 'message')) {
                let data2 = data.message;
                const _errs6 = errors;
                if (errors === _errs6) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 16384) {
                      validate60.errors = [
                        {
                          instancePath: instancePath + '/message',
                          schemaPath: '#/properties/message/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 16384 },
                          message: 'must NOT have more than 16384 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate60.errors = [
                          {
                            instancePath: instancePath + '/message',
                            schemaPath: '#/properties/message/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate60.errors = [
                      {
                        instancePath: instancePath + '/message',
                        schemaPath: '#/properties/message/type',
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
                if (data.affectsStatus !== void 0 && func0.call(data, 'affectsStatus')) {
                  const _errs8 = errors;
                  if (typeof data.affectsStatus !== 'boolean') {
                    validate60.errors = [
                      {
                        instancePath: instancePath + '/affectsStatus',
                        schemaPath: '#/properties/affectsStatus/type',
                        keyword: 'type',
                        params: { type: 'boolean' },
                        message: 'must be boolean',
                      },
                    ];
                    return false;
                  }
                  var valid0 = _errs8 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.scope !== void 0 && func0.call(data, 'scope')) {
                    const _errs10 = errors;
                    if (
                      !validate28(data.scope, {
                        instancePath: instancePath + '/scope',
                        parentData: data,
                        parentDataProperty: 'scope',
                        rootData,
                        dynamicAnchors,
                      })
                    ) {
                      vErrors =
                        vErrors === null ? validate28.errors : vErrors.concat(validate28.errors);
                      errors = vErrors.length;
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.entityId !== void 0 && func0.call(data, 'entityId')) {
                      let data5 = data.entityId;
                      const _errs11 = errors;
                      const _errs12 = errors;
                      if (errors === _errs12) {
                        if (typeof data5 === 'string') {
                          if (func81(data5) > 512) {
                            validate60.errors = [
                              {
                                instancePath: instancePath + '/entityId',
                                schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                keyword: 'maxLength',
                                params: { limit: 512 },
                                message: 'must NOT have more than 512 characters',
                              },
                            ];
                            return false;
                          } else {
                            if (func81(data5) < 1) {
                              validate60.errors = [
                                {
                                  instancePath: instancePath + '/entityId',
                                  schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                  keyword: 'minLength',
                                  params: { limit: 1 },
                                  message: 'must NOT have fewer than 1 characters',
                                },
                              ];
                              return false;
                            }
                          }
                        } else {
                          validate60.errors = [
                            {
                              instancePath: instancePath + '/entityId',
                              schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
                      if (data.causes !== void 0 && func0.call(data, 'causes')) {
                        let data6 = data.causes;
                        const _errs14 = errors;
                        if (errors === _errs14) {
                          if (Array.isArray(data6)) {
                            if (data6.length > 100) {
                              validate60.errors = [
                                {
                                  instancePath: instancePath + '/causes',
                                  schemaPath: '#/properties/causes/maxItems',
                                  keyword: 'maxItems',
                                  params: { limit: 100 },
                                  message: 'must NOT have more than 100 items',
                                },
                              ];
                              return false;
                            } else {
                              var valid3 = true;
                              const len0 = data6.length;
                              for (let i0 = 0; i0 < len0; i0++) {
                                let data7 = data6[i0];
                                const _errs16 = errors;
                                const _errs17 = errors;
                                if (errors === _errs17) {
                                  if (typeof data7 === 'string') {
                                    if (func81(data7) > 512) {
                                      validate60.errors = [
                                        {
                                          instancePath: instancePath + '/causes/' + i0,
                                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                          keyword: 'maxLength',
                                          params: { limit: 512 },
                                          message: 'must NOT have more than 512 characters',
                                        },
                                      ];
                                      return false;
                                    } else {
                                      if (func81(data7) < 1) {
                                        validate60.errors = [
                                          {
                                            instancePath: instancePath + '/causes/' + i0,
                                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                            keyword: 'minLength',
                                            params: { limit: 1 },
                                            message: 'must NOT have fewer than 1 characters',
                                          },
                                        ];
                                        return false;
                                      }
                                    }
                                  } else {
                                    validate60.errors = [
                                      {
                                        instancePath: instancePath + '/causes/' + i0,
                                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                        keyword: 'type',
                                        params: { type: 'string' },
                                        message: 'must be string',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                                var valid3 = _errs16 === errors;
                                if (!valid3) {
                                  break;
                                }
                              }
                            }
                          } else {
                            validate60.errors = [
                              {
                                instancePath: instancePath + '/causes',
                                schemaPath: '#/properties/causes/type',
                                keyword: 'type',
                                params: { type: 'array' },
                                message: 'must be array',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs14 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (data.evidence !== void 0 && func0.call(data, 'evidence')) {
                          let data8 = data.evidence;
                          const _errs19 = errors;
                          if (errors === _errs19) {
                            if (Array.isArray(data8)) {
                              if (data8.length > 1e3) {
                                validate60.errors = [
                                  {
                                    instancePath: instancePath + '/evidence',
                                    schemaPath: '#/properties/evidence/maxItems',
                                    keyword: 'maxItems',
                                    params: { limit: 1e3 },
                                    message: 'must NOT have more than 1000 items',
                                  },
                                ];
                                return false;
                              } else {
                                var valid5 = true;
                                const len1 = data8.length;
                                for (let i1 = 0; i1 < len1; i1++) {
                                  const _errs21 = errors;
                                  if (
                                    !validate42(data8[i1], {
                                      instancePath: instancePath + '/evidence/' + i1,
                                      parentData: data8,
                                      parentDataProperty: i1,
                                      rootData,
                                      dynamicAnchors,
                                    })
                                  ) {
                                    vErrors =
                                      vErrors === null
                                        ? validate42.errors
                                        : vErrors.concat(validate42.errors);
                                    errors = vErrors.length;
                                  }
                                  var valid5 = _errs21 === errors;
                                  if (!valid5) {
                                    break;
                                  }
                                }
                              }
                            } else {
                              validate60.errors = [
                                {
                                  instancePath: instancePath + '/evidence',
                                  schemaPath: '#/properties/evidence/type',
                                  keyword: 'type',
                                  params: { type: 'array' },
                                  message: 'must be array',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid0 = _errs19 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.renewal !== void 0 && func0.call(data, 'renewal')) {
                            const _errs22 = errors;
                            if (
                              !validate49(data.renewal, {
                                instancePath: instancePath + '/renewal',
                                parentData: data,
                                parentDataProperty: 'renewal',
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate49.errors
                                  : vErrors.concat(validate49.errors);
                              errors = vErrors.length;
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
    } else {
      validate60.errors = [
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
  validate60.errors = vErrors;
  return errors === 0;
}
validate60.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var schema92 = {
  title: 'WisCompatibilitySummary',
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    status: { enum: ['compatible', 'conditionally-compatible', 'incompatible'] },
    baseline: { $ref: '#/$defs/ContractReference' },
    unsupportedCapabilities: {
      type: 'array',
      maxItems: 1e3,
      uniqueItems: true,
      items: { $ref: '#/$defs/NonEmptyIdentifier' },
    },
    losses: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
    migrations: { type: 'array', maxItems: 1e3, items: { $ref: '#/$defs/NonEmptyIdentifier' } },
  },
};
function validate66(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate66.evaluated;
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
        ((data.id === void 0 || !func0.call(data, 'id')) && (missing0 = 'id')) ||
        ((data.version === void 0 || !func0.call(data, 'version')) && (missing0 = 'version'))
      ) {
        validate66.errors = [
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
          if (!(key0 === 'id' || key0 === 'version' || key0 === 'profile')) {
            validate66.errors = [
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
          if (data.id !== void 0 && func0.call(data, 'id')) {
            let data0 = data.id;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate66.errors = [
                    {
                      instancePath: instancePath + '/id',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate66.errors = [
                      {
                        instancePath: instancePath + '/id',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate66.errors = [
                  {
                    instancePath: instancePath + '/id',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.version !== void 0 && func0.call(data, 'version')) {
              let data1 = data.version;
              const _errs5 = errors;
              const _errs6 = errors;
              if (errors === _errs6) {
                if (typeof data1 === 'string') {
                  if (func81(data1) > 512) {
                    validate66.errors = [
                      {
                        instancePath: instancePath + '/version',
                        schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                        keyword: 'maxLength',
                        params: { limit: 512 },
                        message: 'must NOT have more than 512 characters',
                      },
                    ];
                    return false;
                  } else {
                    if (func81(data1) < 1) {
                      validate66.errors = [
                        {
                          instancePath: instancePath + '/version',
                          schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                          keyword: 'minLength',
                          params: { limit: 1 },
                          message: 'must NOT have fewer than 1 characters',
                        },
                      ];
                      return false;
                    }
                  }
                } else {
                  validate66.errors = [
                    {
                      instancePath: instancePath + '/version',
                      schemaPath: '#/$defs/NonEmptyIdentifier/type',
                      keyword: 'type',
                      params: { type: 'string' },
                      message: 'must be string',
                    },
                  ];
                  return false;
                }
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.profile !== void 0 && func0.call(data, 'profile')) {
                let data2 = data.profile;
                const _errs8 = errors;
                const _errs9 = errors;
                if (errors === _errs9) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 512) {
                      validate66.errors = [
                        {
                          instancePath: instancePath + '/profile',
                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 512 },
                          message: 'must NOT have more than 512 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate66.errors = [
                          {
                            instancePath: instancePath + '/profile',
                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate66.errors = [
                      {
                        instancePath: instancePath + '/profile',
                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            }
          }
        }
      }
    } else {
      validate66.errors = [
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
  validate66.errors = vErrors;
  return errors === 0;
}
validate66.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
function validate65(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate65.evaluated;
  if (evaluated0.dynamicProps) {
    evaluated0.props = void 0;
  }
  if (evaluated0.dynamicItems) {
    evaluated0.items = void 0;
  }
  if (errors === 0) {
    if (data && typeof data == 'object' && !Array.isArray(data)) {
      let missing0;
      if ((data.status === void 0 || !func0.call(data, 'status')) && (missing0 = 'status')) {
        validate65.errors = [
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
            key0 === 'status' ||
            key0 === 'baseline' ||
            key0 === 'unsupportedCapabilities' ||
            key0 === 'losses' ||
            key0 === 'migrations'
          )) {
            validate65.errors = [
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
          if (data.status !== void 0 && func0.call(data, 'status')) {
            let data0 = data.status;
            const _errs2 = errors;
            if (!(
              data0 === 'compatible' ||
              data0 === 'conditionally-compatible' ||
              data0 === 'incompatible'
            )) {
              validate65.errors = [
                {
                  instancePath: instancePath + '/status',
                  schemaPath: '#/properties/status/enum',
                  keyword: 'enum',
                  params: { allowedValues: schema92.properties.status.enum },
                  message: 'must be equal to one of the allowed values',
                },
              ];
              return false;
            }
            var valid0 = _errs2 === errors;
          } else {
            var valid0 = true;
          }
          if (valid0) {
            if (data.baseline !== void 0 && func0.call(data, 'baseline')) {
              const _errs3 = errors;
              if (
                !validate66(data.baseline, {
                  instancePath: instancePath + '/baseline',
                  parentData: data,
                  parentDataProperty: 'baseline',
                  rootData,
                  dynamicAnchors,
                })
              ) {
                vErrors = vErrors === null ? validate66.errors : vErrors.concat(validate66.errors);
                errors = vErrors.length;
              }
              var valid0 = _errs3 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (
                data.unsupportedCapabilities !== void 0 &&
                func0.call(data, 'unsupportedCapabilities')
              ) {
                let data2 = data.unsupportedCapabilities;
                const _errs4 = errors;
                if (errors === _errs4) {
                  if (Array.isArray(data2)) {
                    if (data2.length > 1e3) {
                      validate65.errors = [
                        {
                          instancePath: instancePath + '/unsupportedCapabilities',
                          schemaPath: '#/properties/unsupportedCapabilities/maxItems',
                          keyword: 'maxItems',
                          params: { limit: 1e3 },
                          message: 'must NOT have more than 1000 items',
                        },
                      ];
                      return false;
                    } else {
                      var valid1 = true;
                      const len0 = data2.length;
                      for (let i0 = 0; i0 < len0; i0++) {
                        let data3 = data2[i0];
                        const _errs6 = errors;
                        const _errs7 = errors;
                        if (errors === _errs7) {
                          if (typeof data3 === 'string') {
                            if (func81(data3) > 512) {
                              validate65.errors = [
                                {
                                  instancePath: instancePath + '/unsupportedCapabilities/' + i0,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 512 },
                                  message: 'must NOT have more than 512 characters',
                                },
                              ];
                              return false;
                            } else {
                              if (func81(data3) < 1) {
                                validate65.errors = [
                                  {
                                    instancePath: instancePath + '/unsupportedCapabilities/' + i0,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 1 },
                                    message: 'must NOT have fewer than 1 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate65.errors = [
                              {
                                instancePath: instancePath + '/unsupportedCapabilities/' + i0,
                                schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid1 = _errs6 === errors;
                        if (!valid1) {
                          break;
                        }
                      }
                      if (valid1) {
                        let i1 = data2.length;
                        let j0;
                        if (i1 > 1) {
                          outer0: for (; i1--;) {
                            for (j0 = i1; j0--;) {
                              if (func27(data2[i1], data2[j0])) {
                                validate65.errors = [
                                  {
                                    instancePath: instancePath + '/unsupportedCapabilities',
                                    schemaPath: '#/properties/unsupportedCapabilities/uniqueItems',
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
                                break outer0;
                              }
                            }
                          }
                        }
                      }
                    }
                  } else {
                    validate65.errors = [
                      {
                        instancePath: instancePath + '/unsupportedCapabilities',
                        schemaPath: '#/properties/unsupportedCapabilities/type',
                        keyword: 'type',
                        params: { type: 'array' },
                        message: 'must be array',
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
                if (data.losses !== void 0 && func0.call(data, 'losses')) {
                  let data4 = data.losses;
                  const _errs9 = errors;
                  if (errors === _errs9) {
                    if (Array.isArray(data4)) {
                      if (data4.length > 1e3) {
                        validate65.errors = [
                          {
                            instancePath: instancePath + '/losses',
                            schemaPath: '#/properties/losses/maxItems',
                            keyword: 'maxItems',
                            params: { limit: 1e3 },
                            message: 'must NOT have more than 1000 items',
                          },
                        ];
                        return false;
                      } else {
                        var valid4 = true;
                        const len1 = data4.length;
                        for (let i2 = 0; i2 < len1; i2++) {
                          let data5 = data4[i2];
                          const _errs11 = errors;
                          const _errs12 = errors;
                          if (errors === _errs12) {
                            if (typeof data5 === 'string') {
                              if (func81(data5) > 512) {
                                validate65.errors = [
                                  {
                                    instancePath: instancePath + '/losses/' + i2,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                    keyword: 'maxLength',
                                    params: { limit: 512 },
                                    message: 'must NOT have more than 512 characters',
                                  },
                                ];
                                return false;
                              } else {
                                if (func81(data5) < 1) {
                                  validate65.errors = [
                                    {
                                      instancePath: instancePath + '/losses/' + i2,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                      keyword: 'minLength',
                                      params: { limit: 1 },
                                      message: 'must NOT have fewer than 1 characters',
                                    },
                                  ];
                                  return false;
                                }
                              }
                            } else {
                              validate65.errors = [
                                {
                                  instancePath: instancePath + '/losses/' + i2,
                                  schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                  keyword: 'type',
                                  params: { type: 'string' },
                                  message: 'must be string',
                                },
                              ];
                              return false;
                            }
                          }
                          var valid4 = _errs11 === errors;
                          if (!valid4) {
                            break;
                          }
                        }
                      }
                    } else {
                      validate65.errors = [
                        {
                          instancePath: instancePath + '/losses',
                          schemaPath: '#/properties/losses/type',
                          keyword: 'type',
                          params: { type: 'array' },
                          message: 'must be array',
                        },
                      ];
                      return false;
                    }
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.migrations !== void 0 && func0.call(data, 'migrations')) {
                    let data6 = data.migrations;
                    const _errs14 = errors;
                    if (errors === _errs14) {
                      if (Array.isArray(data6)) {
                        if (data6.length > 1e3) {
                          validate65.errors = [
                            {
                              instancePath: instancePath + '/migrations',
                              schemaPath: '#/properties/migrations/maxItems',
                              keyword: 'maxItems',
                              params: { limit: 1e3 },
                              message: 'must NOT have more than 1000 items',
                            },
                          ];
                          return false;
                        } else {
                          var valid6 = true;
                          const len2 = data6.length;
                          for (let i3 = 0; i3 < len2; i3++) {
                            let data7 = data6[i3];
                            const _errs16 = errors;
                            const _errs17 = errors;
                            if (errors === _errs17) {
                              if (typeof data7 === 'string') {
                                if (func81(data7) > 512) {
                                  validate65.errors = [
                                    {
                                      instancePath: instancePath + '/migrations/' + i3,
                                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                      keyword: 'maxLength',
                                      params: { limit: 512 },
                                      message: 'must NOT have more than 512 characters',
                                    },
                                  ];
                                  return false;
                                } else {
                                  if (func81(data7) < 1) {
                                    validate65.errors = [
                                      {
                                        instancePath: instancePath + '/migrations/' + i3,
                                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                        keyword: 'minLength',
                                        params: { limit: 1 },
                                        message: 'must NOT have fewer than 1 characters',
                                      },
                                    ];
                                    return false;
                                  }
                                }
                              } else {
                                validate65.errors = [
                                  {
                                    instancePath: instancePath + '/migrations/' + i3,
                                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                    keyword: 'type',
                                    params: { type: 'string' },
                                    message: 'must be string',
                                  },
                                ];
                                return false;
                              }
                            }
                            var valid6 = _errs16 === errors;
                            if (!valid6) {
                              break;
                            }
                          }
                        }
                      } else {
                        validate65.errors = [
                          {
                            instancePath: instancePath + '/migrations',
                            schemaPath: '#/properties/migrations/type',
                            keyword: 'type',
                            params: { type: 'array' },
                            message: 'must be array',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs14 === errors;
                  } else {
                    var valid0 = true;
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate65.errors = [
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
  validate65.errors = vErrors;
  return errors === 0;
}
validate65.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
var pattern16 = new RegExp('^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$', 'u');
function validate23(
  data,
  { instancePath = '', parentData, parentDataProperty, rootData = data, dynamicAnchors = {} } = {}
) {
  let vErrors = null;
  let errors = 0;
  const evaluated0 = validate23.evaluated;
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
        ((data.specVersion === void 0 || !func0.call(data, 'specVersion')) &&
          (missing0 = 'specVersion')) ||
        ((data.coreVersion === void 0 || !func0.call(data, 'coreVersion')) &&
          (missing0 = 'coreVersion')) ||
        ((data.schemaId === void 0 || !func0.call(data, 'schemaId')) && (missing0 = 'schemaId')) ||
        ((data.profile === void 0 || !func0.call(data, 'profile')) && (missing0 = 'profile')) ||
        ((data.producer === void 0 || !func0.call(data, 'producer')) && (missing0 = 'producer')) ||
        ((data.operation === void 0 || !func0.call(data, 'operation')) &&
          (missing0 = 'operation')) ||
        ((data.operationOutcome === void 0 || !func0.call(data, 'operationOutcome')) &&
          (missing0 = 'operationOutcome')) ||
        ((data.scope === void 0 || !func0.call(data, 'scope')) && (missing0 = 'scope')) ||
        ((data.generation === void 0 || !func0.call(data, 'generation')) &&
          (missing0 = 'generation')) ||
        ((data.status === void 0 || !func0.call(data, 'status')) && (missing0 = 'status')) ||
        ((data.evidence === void 0 || !func0.call(data, 'evidence')) && (missing0 = 'evidence')) ||
        ((data.freshness === void 0 || !func0.call(data, 'freshness')) &&
          (missing0 = 'freshness')) ||
        ((data.unknowns === void 0 || !func0.call(data, 'unknowns')) && (missing0 = 'unknowns')) ||
        ((data.omissions === void 0 || !func0.call(data, 'omissions')) &&
          (missing0 = 'omissions')) ||
        ((data.diagnostics === void 0 || !func0.call(data, 'diagnostics')) &&
          (missing0 = 'diagnostics')) ||
        ((data.compatibility === void 0 || !func0.call(data, 'compatibility')) &&
          (missing0 = 'compatibility'))
      ) {
        validate23.errors = [
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
          if (!func0.call(schema36.properties, key0)) {
            validate23.errors = [
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
          if (data.specVersion !== void 0 && func0.call(data, 'specVersion')) {
            let data0 = data.specVersion;
            const _errs2 = errors;
            const _errs3 = errors;
            if (errors === _errs3) {
              if (typeof data0 === 'string') {
                if (func81(data0) > 512) {
                  validate23.errors = [
                    {
                      instancePath: instancePath + '/specVersion',
                      schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                      keyword: 'maxLength',
                      params: { limit: 512 },
                      message: 'must NOT have more than 512 characters',
                    },
                  ];
                  return false;
                } else {
                  if (func81(data0) < 1) {
                    validate23.errors = [
                      {
                        instancePath: instancePath + '/specVersion',
                        schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                        keyword: 'minLength',
                        params: { limit: 1 },
                        message: 'must NOT have fewer than 1 characters',
                      },
                    ];
                    return false;
                  }
                }
              } else {
                validate23.errors = [
                  {
                    instancePath: instancePath + '/specVersion',
                    schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
            if (data.coreVersion !== void 0 && func0.call(data, 'coreVersion')) {
              const _errs5 = errors;
              if ('0.2.0-draft' !== data.coreVersion) {
                validate23.errors = [
                  {
                    instancePath: instancePath + '/coreVersion',
                    schemaPath: '#/properties/coreVersion/const',
                    keyword: 'const',
                    params: { allowedValue: '0.2.0-draft' },
                    message: 'must be equal to constant',
                  },
                ];
                return false;
              }
              var valid0 = _errs5 === errors;
            } else {
              var valid0 = true;
            }
            if (valid0) {
              if (data.schemaId !== void 0 && func0.call(data, 'schemaId')) {
                let data2 = data.schemaId;
                const _errs6 = errors;
                const _errs7 = errors;
                if (errors === _errs7) {
                  if (typeof data2 === 'string') {
                    if (func81(data2) > 512) {
                      validate23.errors = [
                        {
                          instancePath: instancePath + '/schemaId',
                          schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                          keyword: 'maxLength',
                          params: { limit: 512 },
                          message: 'must NOT have more than 512 characters',
                        },
                      ];
                      return false;
                    } else {
                      if (func81(data2) < 1) {
                        validate23.errors = [
                          {
                            instancePath: instancePath + '/schemaId',
                            schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                            keyword: 'minLength',
                            params: { limit: 1 },
                            message: 'must NOT have fewer than 1 characters',
                          },
                        ];
                        return false;
                      }
                    }
                  } else {
                    validate23.errors = [
                      {
                        instancePath: instancePath + '/schemaId',
                        schemaPath: '#/$defs/NonEmptyIdentifier/type',
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
                if (data.profile !== void 0 && func0.call(data, 'profile')) {
                  const _errs9 = errors;
                  if (
                    !validate24(data.profile, {
                      instancePath: instancePath + '/profile',
                      parentData: data,
                      parentDataProperty: 'profile',
                      rootData,
                      dynamicAnchors,
                    })
                  ) {
                    vErrors =
                      vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
                    errors = vErrors.length;
                  }
                  var valid0 = _errs9 === errors;
                } else {
                  var valid0 = true;
                }
                if (valid0) {
                  if (data.artifactId !== void 0 && func0.call(data, 'artifactId')) {
                    let data4 = data.artifactId;
                    const _errs10 = errors;
                    const _errs11 = errors;
                    if (errors === _errs11) {
                      if (typeof data4 === 'string') {
                        if (func81(data4) > 512) {
                          validate23.errors = [
                            {
                              instancePath: instancePath + '/artifactId',
                              schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                              keyword: 'maxLength',
                              params: { limit: 512 },
                              message: 'must NOT have more than 512 characters',
                            },
                          ];
                          return false;
                        } else {
                          if (func81(data4) < 1) {
                            validate23.errors = [
                              {
                                instancePath: instancePath + '/artifactId',
                                schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                keyword: 'minLength',
                                params: { limit: 1 },
                                message: 'must NOT have fewer than 1 characters',
                              },
                            ];
                            return false;
                          }
                        }
                      } else {
                        validate23.errors = [
                          {
                            instancePath: instancePath + '/artifactId',
                            schemaPath: '#/$defs/NonEmptyIdentifier/type',
                            keyword: 'type',
                            params: { type: 'string' },
                            message: 'must be string',
                          },
                        ];
                        return false;
                      }
                    }
                    var valid0 = _errs10 === errors;
                  } else {
                    var valid0 = true;
                  }
                  if (valid0) {
                    if (data.producer !== void 0 && func0.call(data, 'producer')) {
                      const _errs13 = errors;
                      if (
                        !validate26(data.producer, {
                          instancePath: instancePath + '/producer',
                          parentData: data,
                          parentDataProperty: 'producer',
                          rootData,
                          dynamicAnchors,
                        })
                      ) {
                        vErrors =
                          vErrors === null ? validate26.errors : vErrors.concat(validate26.errors);
                        errors = vErrors.length;
                      }
                      var valid0 = _errs13 === errors;
                    } else {
                      var valid0 = true;
                    }
                    if (valid0) {
                      if (data.operation !== void 0 && func0.call(data, 'operation')) {
                        let data6 = data.operation;
                        const _errs14 = errors;
                        const _errs15 = errors;
                        if (errors === _errs15) {
                          if (typeof data6 === 'string') {
                            if (func81(data6) > 512) {
                              validate23.errors = [
                                {
                                  instancePath: instancePath + '/operation',
                                  schemaPath: '#/$defs/NonEmptyIdentifier/maxLength',
                                  keyword: 'maxLength',
                                  params: { limit: 512 },
                                  message: 'must NOT have more than 512 characters',
                                },
                              ];
                              return false;
                            } else {
                              if (func81(data6) < 1) {
                                validate23.errors = [
                                  {
                                    instancePath: instancePath + '/operation',
                                    schemaPath: '#/$defs/NonEmptyIdentifier/minLength',
                                    keyword: 'minLength',
                                    params: { limit: 1 },
                                    message: 'must NOT have fewer than 1 characters',
                                  },
                                ];
                                return false;
                              }
                            }
                          } else {
                            validate23.errors = [
                              {
                                instancePath: instancePath + '/operation',
                                schemaPath: '#/$defs/NonEmptyIdentifier/type',
                                keyword: 'type',
                                params: { type: 'string' },
                                message: 'must be string',
                              },
                            ];
                            return false;
                          }
                        }
                        var valid0 = _errs14 === errors;
                      } else {
                        var valid0 = true;
                      }
                      if (valid0) {
                        if (
                          data.operationOutcome !== void 0 &&
                          func0.call(data, 'operationOutcome')
                        ) {
                          let data7 = data.operationOutcome;
                          const _errs17 = errors;
                          if (!(
                            data7 === 'succeeded' ||
                            data7 === 'failed' ||
                            data7 === 'cancelled'
                          )) {
                            validate23.errors = [
                              {
                                instancePath: instancePath + '/operationOutcome',
                                schemaPath: '#/properties/operationOutcome/enum',
                                keyword: 'enum',
                                params: {
                                  allowedValues: schema36.properties.operationOutcome.enum,
                                },
                                message: 'must be equal to one of the allowed values',
                              },
                            ];
                            return false;
                          }
                          var valid0 = _errs17 === errors;
                        } else {
                          var valid0 = true;
                        }
                        if (valid0) {
                          if (data.scope !== void 0 && func0.call(data, 'scope')) {
                            const _errs18 = errors;
                            if (
                              !validate28(data.scope, {
                                instancePath: instancePath + '/scope',
                                parentData: data,
                                parentDataProperty: 'scope',
                                rootData,
                                dynamicAnchors,
                              })
                            ) {
                              vErrors =
                                vErrors === null
                                  ? validate28.errors
                                  : vErrors.concat(validate28.errors);
                              errors = vErrors.length;
                            }
                            var valid0 = _errs18 === errors;
                          } else {
                            var valid0 = true;
                          }
                          if (valid0) {
                            if (data.generation !== void 0 && func0.call(data, 'generation')) {
                              const _errs19 = errors;
                              if (
                                !validate38(data.generation, {
                                  instancePath: instancePath + '/generation',
                                  parentData: data,
                                  parentDataProperty: 'generation',
                                  rootData,
                                  dynamicAnchors,
                                })
                              ) {
                                vErrors =
                                  vErrors === null
                                    ? validate38.errors
                                    : vErrors.concat(validate38.errors);
                                errors = vErrors.length;
                              }
                              var valid0 = _errs19 === errors;
                            } else {
                              var valid0 = true;
                            }
                            if (valid0) {
                              if (data.status !== void 0 && func0.call(data, 'status')) {
                                let data10 = data.status;
                                const _errs20 = errors;
                                if (!(
                                  data10 === 'pass' ||
                                  data10 === 'attention' ||
                                  data10 === 'blocked' ||
                                  data10 === 'partial' ||
                                  data10 === 'failed'
                                )) {
                                  validate23.errors = [
                                    {
                                      instancePath: instancePath + '/status',
                                      schemaPath: '#/properties/status/enum',
                                      keyword: 'enum',
                                      params: { allowedValues: schema36.properties.status.enum },
                                      message: 'must be equal to one of the allowed values',
                                    },
                                  ];
                                  return false;
                                }
                                var valid0 = _errs20 === errors;
                              } else {
                                var valid0 = true;
                              }
                              if (valid0) {
                                if (data.evidence !== void 0 && func0.call(data, 'evidence')) {
                                  let data11 = data.evidence;
                                  const _errs21 = errors;
                                  if (errors === _errs21) {
                                    if (Array.isArray(data11)) {
                                      if (data11.length > 1e4) {
                                        validate23.errors = [
                                          {
                                            instancePath: instancePath + '/evidence',
                                            schemaPath: '#/properties/evidence/maxItems',
                                            keyword: 'maxItems',
                                            params: { limit: 1e4 },
                                            message: 'must NOT have more than 10000 items',
                                          },
                                        ];
                                        return false;
                                      } else {
                                        var valid5 = true;
                                        const len0 = data11.length;
                                        for (let i0 = 0; i0 < len0; i0++) {
                                          const _errs23 = errors;
                                          if (
                                            !validate42(data11[i0], {
                                              instancePath: instancePath + '/evidence/' + i0,
                                              parentData: data11,
                                              parentDataProperty: i0,
                                              rootData,
                                              dynamicAnchors,
                                            })
                                          ) {
                                            vErrors =
                                              vErrors === null
                                                ? validate42.errors
                                                : vErrors.concat(validate42.errors);
                                            errors = vErrors.length;
                                          }
                                          var valid5 = _errs23 === errors;
                                          if (!valid5) {
                                            break;
                                          }
                                        }
                                      }
                                    } else {
                                      validate23.errors = [
                                        {
                                          instancePath: instancePath + '/evidence',
                                          schemaPath: '#/properties/evidence/type',
                                          keyword: 'type',
                                          params: { type: 'array' },
                                          message: 'must be array',
                                        },
                                      ];
                                      return false;
                                    }
                                  }
                                  var valid0 = _errs21 === errors;
                                } else {
                                  var valid0 = true;
                                }
                                if (valid0) {
                                  if (data.freshness !== void 0 && func0.call(data, 'freshness')) {
                                    const _errs24 = errors;
                                    if (
                                      !validate48(data.freshness, {
                                        instancePath: instancePath + '/freshness',
                                        parentData: data,
                                        parentDataProperty: 'freshness',
                                        rootData,
                                        dynamicAnchors,
                                      })
                                    ) {
                                      vErrors =
                                        vErrors === null
                                          ? validate48.errors
                                          : vErrors.concat(validate48.errors);
                                      errors = vErrors.length;
                                    }
                                    var valid0 = _errs24 === errors;
                                  } else {
                                    var valid0 = true;
                                  }
                                  if (valid0) {
                                    if (data.unknowns !== void 0 && func0.call(data, 'unknowns')) {
                                      let data14 = data.unknowns;
                                      const _errs25 = errors;
                                      if (errors === _errs25) {
                                        if (Array.isArray(data14)) {
                                          if (data14.length > 1e3) {
                                            validate23.errors = [
                                              {
                                                instancePath: instancePath + '/unknowns',
                                                schemaPath: '#/properties/unknowns/maxItems',
                                                keyword: 'maxItems',
                                                params: { limit: 1e3 },
                                                message: 'must NOT have more than 1000 items',
                                              },
                                            ];
                                            return false;
                                          } else {
                                            var valid6 = true;
                                            const len1 = data14.length;
                                            for (let i1 = 0; i1 < len1; i1++) {
                                              const _errs27 = errors;
                                              if (
                                                !validate53(data14[i1], {
                                                  instancePath: instancePath + '/unknowns/' + i1,
                                                  parentData: data14,
                                                  parentDataProperty: i1,
                                                  rootData,
                                                  dynamicAnchors,
                                                })
                                              ) {
                                                vErrors =
                                                  vErrors === null
                                                    ? validate53.errors
                                                    : vErrors.concat(validate53.errors);
                                                errors = vErrors.length;
                                              }
                                              var valid6 = _errs27 === errors;
                                              if (!valid6) {
                                                break;
                                              }
                                            }
                                          }
                                        } else {
                                          validate23.errors = [
                                            {
                                              instancePath: instancePath + '/unknowns',
                                              schemaPath: '#/properties/unknowns/type',
                                              keyword: 'type',
                                              params: { type: 'array' },
                                              message: 'must be array',
                                            },
                                          ];
                                          return false;
                                        }
                                      }
                                      var valid0 = _errs25 === errors;
                                    } else {
                                      var valid0 = true;
                                    }
                                    if (valid0) {
                                      if (
                                        data.omissions !== void 0 &&
                                        func0.call(data, 'omissions')
                                      ) {
                                        let data16 = data.omissions;
                                        const _errs28 = errors;
                                        if (errors === _errs28) {
                                          if (Array.isArray(data16)) {
                                            if (data16.length > 1e3) {
                                              validate23.errors = [
                                                {
                                                  instancePath: instancePath + '/omissions',
                                                  schemaPath: '#/properties/omissions/maxItems',
                                                  keyword: 'maxItems',
                                                  params: { limit: 1e3 },
                                                  message: 'must NOT have more than 1000 items',
                                                },
                                              ];
                                              return false;
                                            } else {
                                              var valid7 = true;
                                              const len2 = data16.length;
                                              for (let i2 = 0; i2 < len2; i2++) {
                                                const _errs30 = errors;
                                                if (
                                                  !validate56(data16[i2], {
                                                    instancePath: instancePath + '/omissions/' + i2,
                                                    parentData: data16,
                                                    parentDataProperty: i2,
                                                    rootData,
                                                    dynamicAnchors,
                                                  })
                                                ) {
                                                  vErrors =
                                                    vErrors === null
                                                      ? validate56.errors
                                                      : vErrors.concat(validate56.errors);
                                                  errors = vErrors.length;
                                                }
                                                var valid7 = _errs30 === errors;
                                                if (!valid7) {
                                                  break;
                                                }
                                              }
                                            }
                                          } else {
                                            validate23.errors = [
                                              {
                                                instancePath: instancePath + '/omissions',
                                                schemaPath: '#/properties/omissions/type',
                                                keyword: 'type',
                                                params: { type: 'array' },
                                                message: 'must be array',
                                              },
                                            ];
                                            return false;
                                          }
                                        }
                                        var valid0 = _errs28 === errors;
                                      } else {
                                        var valid0 = true;
                                      }
                                      if (valid0) {
                                        if (
                                          data.diagnostics !== void 0 &&
                                          func0.call(data, 'diagnostics')
                                        ) {
                                          let data18 = data.diagnostics;
                                          const _errs31 = errors;
                                          if (errors === _errs31) {
                                            if (Array.isArray(data18)) {
                                              if (data18.length > 1e3) {
                                                validate23.errors = [
                                                  {
                                                    instancePath: instancePath + '/diagnostics',
                                                    schemaPath: '#/properties/diagnostics/maxItems',
                                                    keyword: 'maxItems',
                                                    params: { limit: 1e3 },
                                                    message: 'must NOT have more than 1000 items',
                                                  },
                                                ];
                                                return false;
                                              } else {
                                                var valid8 = true;
                                                const len3 = data18.length;
                                                for (let i3 = 0; i3 < len3; i3++) {
                                                  const _errs33 = errors;
                                                  if (
                                                    !validate60(data18[i3], {
                                                      instancePath:
                                                        instancePath + '/diagnostics/' + i3,
                                                      parentData: data18,
                                                      parentDataProperty: i3,
                                                      rootData,
                                                      dynamicAnchors,
                                                    })
                                                  ) {
                                                    vErrors =
                                                      vErrors === null
                                                        ? validate60.errors
                                                        : vErrors.concat(validate60.errors);
                                                    errors = vErrors.length;
                                                  }
                                                  var valid8 = _errs33 === errors;
                                                  if (!valid8) {
                                                    break;
                                                  }
                                                }
                                              }
                                            } else {
                                              validate23.errors = [
                                                {
                                                  instancePath: instancePath + '/diagnostics',
                                                  schemaPath: '#/properties/diagnostics/type',
                                                  keyword: 'type',
                                                  params: { type: 'array' },
                                                  message: 'must be array',
                                                },
                                              ];
                                              return false;
                                            }
                                          }
                                          var valid0 = _errs31 === errors;
                                        } else {
                                          var valid0 = true;
                                        }
                                        if (valid0) {
                                          if (
                                            data.compatibility !== void 0 &&
                                            func0.call(data, 'compatibility')
                                          ) {
                                            const _errs34 = errors;
                                            if (
                                              !validate65(data.compatibility, {
                                                instancePath: instancePath + '/compatibility',
                                                parentData: data,
                                                parentDataProperty: 'compatibility',
                                                rootData,
                                                dynamicAnchors,
                                              })
                                            ) {
                                              vErrors =
                                                vErrors === null
                                                  ? validate65.errors
                                                  : vErrors.concat(validate65.errors);
                                              errors = vErrors.length;
                                            }
                                            var valid0 = _errs34 === errors;
                                          } else {
                                            var valid0 = true;
                                          }
                                          if (valid0) {
                                            if (
                                              data.extensions !== void 0 &&
                                              func0.call(data, 'extensions')
                                            ) {
                                              let data21 = data.extensions;
                                              const _errs35 = errors;
                                              const _errs36 = errors;
                                              if (errors === _errs36) {
                                                if (
                                                  data21 &&
                                                  typeof data21 == 'object' &&
                                                  !Array.isArray(data21)
                                                ) {
                                                  if (Object.keys(data21).length > 32) {
                                                    validate23.errors = [
                                                      {
                                                        instancePath: instancePath + '/extensions',
                                                        schemaPath:
                                                          '#/$defs/Extensions/maxProperties',
                                                        keyword: 'maxProperties',
                                                        params: { limit: 32 },
                                                        message:
                                                          'must NOT have more than 32 properties',
                                                      },
                                                    ];
                                                    return false;
                                                  } else {
                                                    for (const key1 of Object.keys(data21)) {
                                                      const _errs38 = errors;
                                                      if (typeof key1 === 'string') {
                                                        if (!pattern16.test(key1)) {
                                                          const err0 = {
                                                            instancePath:
                                                              instancePath + '/extensions',
                                                            schemaPath:
                                                              '#/$defs/Extensions/propertyNames/pattern',
                                                            keyword: 'pattern',
                                                            params: {
                                                              pattern:
                                                                '^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$',
                                                            },
                                                            message:
                                                              'must match pattern "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$"',
                                                            propertyName: key1,
                                                          };
                                                          if (vErrors === null) {
                                                            vErrors = [err0];
                                                          } else {
                                                            vErrors.push(err0);
                                                          }
                                                          errors++;
                                                        }
                                                      }
                                                      var valid10 = _errs38 === errors;
                                                      if (!valid10) {
                                                        const err1 = {
                                                          instancePath:
                                                            instancePath + '/extensions',
                                                          schemaPath:
                                                            '#/$defs/Extensions/propertyNames',
                                                          keyword: 'propertyNames',
                                                          params: { propertyName: key1 },
                                                          message: 'property name must be valid',
                                                        };
                                                        if (vErrors === null) {
                                                          vErrors = [err1];
                                                        } else {
                                                          vErrors.push(err1);
                                                        }
                                                        errors++;
                                                        validate23.errors = vErrors;
                                                        return false;
                                                        break;
                                                      }
                                                    }
                                                  }
                                                } else {
                                                  validate23.errors = [
                                                    {
                                                      instancePath: instancePath + '/extensions',
                                                      schemaPath: '#/$defs/Extensions/type',
                                                      keyword: 'type',
                                                      params: { type: 'object' },
                                                      message: 'must be object',
                                                    },
                                                  ];
                                                  return false;
                                                }
                                              }
                                              var valid0 = _errs35 === errors;
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
                    }
                  }
                }
              }
            }
          }
        }
      }
    } else {
      validate23.errors = [
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
  validate23.errors = vErrors;
  return errors === 0;
}
validate23.evaluated = { props: true, dynamicProps: false, dynamicItems: false };
export { validateWisCoreResultEnvelopeStructure };
