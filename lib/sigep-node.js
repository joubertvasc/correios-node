'use strict';
const XMLMapping = require('xml-mapping');
import {Soap} from "./soap.service";

// Códigos de serviços adicionais dos correios
const SERVICE_DELIVERED_NOTICE = "001";
const SERVICE_IN_HANDS = "002";
const SERVICE_DECLARED_VALUE_PAC = "064";
const SERVICE_DECLARED_VALUE_SEDEX = "019";

// Métodos do SIGEP
const SIGEP_METHOD_CONSULTA_SRO = "consultaSRO";
const SIGEP_METHOD_BUSCA_CLIENTE = "buscaCliente";
const SIGEP_METHOD_VERIFICA_DISPONIBILIDADE_SERVICO = "verificaDisponibilidadeServico";
const SIGEP_METHOD_STATUS_CARTAO_POSTAGEM = "getStatusCartaoPostagem";
const SIGEP_METHOD_CONSULTA_CEP = "consultaCEP";
const SIGEP_METHOD_SOLICITA_ETIQUETAS = "solicitaEtiquetas";
const SIGEP_METHOD_GERA_DIGITO_VERIFICADOR_ETIQUETAS = "geraDigitoVerificadorEtiquetas";
const SIGEP_METHOD_FECHA_PLP_VARIOS_SERVICOS = "fechaPlpVariosServicos";
const SIGEP_METHOD_BLOQUEAR_OBJETO = "bloquearObjeto";

export const Sigep = {
    /**
     *
     * Objetivo: fazer chamadas genéricas ao WebService SIGEP dos correios em SOAP
     *
     * @param sigepConfig
     * @param method
     * @param params
     * @param includeUser
     * @returns {Promise<*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    sigepSoapCall: async (sigepConfig, method, params, includeUser = true) => {
        return Soap.soapCallJsonResult(sigepConfig.url,
            Sigep.prepareRequestXML(sigepConfig, method, params, includeUser)
        );
    },

    ////////////////////////////////////////////////////////////////////////////////////
    // Objetivo: montar o envelope SOAP com o XML de request chamar o WS dos Correios //
    ////////////////////////////////////////////////////////////////////////////////////
    prepareRequestXML: (sigepConfig, method, params, includeUser) => {
        let xml = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cli="http://cliente.bean.master.sigep.bsb.correios.com.br/">
                  <soapenv:Header/>
                  <soapenv:Body>
                    <cli:${method}>`;

        if (params) {
            params.map(param => {
                xml += `          <${param.key}>${param.value}</${param.key}>`;
            });
        }

        if (includeUser) {
            xml += `<usuario>${sigepConfig.login}</usuario>
                    <senha>${sigepConfig.password}</senha>`;
        }

        xml += `        </cli:${method}>
                  </soapenv:Body>
                </soapenv:Envelope>`;

        return xml;
    },

    /**
     *
     * Objetivo: buscar no WS dos Correios as informações relativas a um objeto
     *
     * @param sigepConfig
     * @param trackNumber
     * @returns {Promise<*|{result: *, success: boolean}|{result: string, success: boolean}|{result: *, success: boolean}|{result: string, success: boolean, ended: *, delivered: *, history: *}>}
     */
    getObjectHistory: async (sigepConfig, trackNumber) => {
        const params = [
            {key: "listaObjetos", value: trackNumber},
            {key: "tipoConsulta", value: "L"},
            {key: "tipoResultado", value: "T"},
            {key: "usuarioSro", value: sigepConfig.loginObjectHistory},
            {key: "senhaSro", value: sigepConfig.passwordObjectHistory}
        ];

        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_CONSULTA_SRO, params, false);

        if (response) {
            try {
                const xmlResult = response.result.ns2$consultaSROResponse.return.$t;
                const events = [];
                let delivered = false;
                let ended = false;
                let isFirst = true;

                const json = XMLMapping.tojson(xmlResult);

                json.rastro.objeto.evento.map(ev => {
                    const type = ev.tipo.$t;
                    const status = ev.status.$t;
                    const date = ev.data.$t + " " + ev.hora.$t;
                    let description = ev.descricao.$t;
                    const details = ev.detalhe.$t == null ? "" : ev.detalhe.$t;

                    if (type === "DO" || type === "RO" || type === "PMT" || type === "TRI") {
                        description += " de: " + ev.local.$t + ", " + ev.cidade.$t + "/" + ev.uf.$t + " para: " +
                            ev.destino.local.$t + ", " + ev.destino.cidade.$t + "/" + ev.destino.uf.$t;
                    }

                    if (isFirst) {
                        if (type === "BDE" || type === "BDI" || type === "BDR") {
                            ended = true;
                            delivered = parseInt(status) <= 1;
                        }
                    }

                    isFirst = false;

                    events.push({
                        type: type,
                        status: status,
                        date: date,
                        description: description,
                        details: details
                    });
                });

                return {
                    delivered: delivered,
                    ended: ended,
                    history: events
                };
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: buscar no WS dos Correios as informações relativas a um contrato
     *
     * @param sigepConfig
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    getClient: async sigepConfig => {
        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_BUSCA_CLIENTE, [
            {key: "idContrato", value: sigepConfig.contract},
            {key: "idCartaoPostagem", value: sigepConfig.postCard}
        ]);

        if (response) {
            try {
                return response.result.ns2$buscaClienteResponse.return;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: verificar se determinado serviço está disponível entre um CEP de origem e um CEP de destino
     *
     * @param sigepConfig
     * @param serviceCode
     * @param originZipCode
     * @param destinyZipCode
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    checkZipCodes: async (sigepConfig, serviceCode, originZipCode, destinyZipCode) => {
        originZipCode = originZipCode.replace("-", "");
        destinyZipCode = destinyZipCode.replace("-", "");

        const params = [
            {key: "codAdministrativo", value: sigepConfig.administrativeCode},
            {key: "numeroServico", value: sigepConfig.serviceCode},
            {key: "cepOrigem", value: originZipCode},
            {key: "cepDestino", value: destinyZipCode}
        ];

        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_VERIFICA_DISPONIBILIDADE_SERVICO, params);

        if (response) {
            try {
                return response.result.ns2$verificaDisponibilidadeServicoResponse.return;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: verificar se determinado cartão de postagem é válido.
     * ATENÇÃO: essa função deve ser chamada uma vez ao dia. Se o cartão não estiver disponível, deve-se entrar em
     * contatos com os correios.
     *
     * @param sigepConfig
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}|{result: boolean, success: boolean}>}
     */
    getPostCardStatus: async sigepConfig => {
        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_STATUS_CARTAO_POSTAGEM,
            [{key: "numeroCartaoPostagem", value: sigepConfig.postCard}]
        );

        if (response) {
            try {
                return response.result.ns2$getStatusCartaoPostagemResponse.return.$t === "Normal";
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: verificar se determinado CEP existe e buscar seus dados
     *
     * @param sigepConfig
     * @param zipCode
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    queryZipCode: async (sigepConfig, zipCode) => {
        zipCode = zipCode.replace("-", "");

        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_CONSULTA_CEP,
            [{key: "cep", value: zipCode}], false);

        if (response) {
            try {
                return response.result.ns2$consultaCEPResponse.return;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: Obter uma faixa de códigos de rastreios, já com seus dígitos verificadores
     *
     * @param sigepConfig
     * @param serviceId
     * @param amount
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    getLabels: async (sigepConfig, serviceId, amount) => {
        const params = [
            {key: "tipoDestinatario", value: "C"},
            {key: "identificador", value: sigepConfig.cnpj},
            {key: "idServico", value: serviceId},
            {key: "qtdEtiquetas", value: amount}
        ];

        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_SOLICITA_ETIQUETAS, params);

        if (response) {
            try {
                const range = response.result.ns2$solicitaEtiquetasResponse.return.$t.split(",");
                let labels = [];
                const prefix = range[0].substring(0, 2);
                const sufix = range[0].substring(11);
                const start = range[0].substring(2, 10);
                const end = range[1].substring(2, 10);

                const paramsDigit = [];

                for (let i = start; i <= end; i++) {
                    const number = "00000000" + i;
                    paramsDigit.push({
                        key: "etiquetas",
                        value: prefix + number.substring(number.length - 8) + sufix
                    });
                }

                const response2 = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_GERA_DIGITO_VERIFICADOR_ETIQUETAS,
                    paramsDigit);

                if (paramsDigit.length === 1) {
                    labels.push(
                        paramsDigit[0].value.substring(0, 10) +
                        response2.result.ns2$geraDigitoVerificadorEtiquetasResponse.return.$t + sufix
                    );
                } else {
                    for (let i = 0; i < paramsDigit.length; i++) {
                        labels.push(
                            paramsDigit[i].value.substring(0, 10) +
                            response2.result.ns2$geraDigitoVerificadorEtiquetasResponse.return[i].$t + sufix
                        );
                    }
                }

                return labels;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: Entregar uma PLP aos correios e obter seu número para consulta futura
     *
     * @param sigepConfig
     * @param labels
     * @returns {Promise<{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    closePLP: async (sigepConfig, labels) => {
        // Monta o XML a enviar para o modo owner
        const xml = await Sigep.createXMLToClosePLP(sigepConfig, labels);
        let params = [
            {key: "xml", value: "<![CDATA[" + xml + "\n]]>"},
            {key: "idPlpCliente", value: labels[0].idInternalPlp},
            {key: "cartaoPostagem", value: sigepConfig.postCard}
        ];

        labels.map(label => {
            let rastreio = label.trackingCode.substring(0, 10) + label.trackingCode.substring(11);
            params.push({key: "listaEtiquetas", value: rastreio});
        });

        // Executa a chamada SOAP
        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_FECHA_PLP_VARIOS_SERVICOS, params);

        // Se houver sucesso retorna o número da PLP dos correios
        if (response) {
            try {
                return response.result.ns2$fechaPlpVariosServicosResponse.return.$t;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: Solicitar o cancelamento do envio de determinado objeto
     *
     * @param sigepConfig
     * @param plpNumber
     * @param trackNumber
     * @returns {Promise<{result: (string|*), success: boolean}|{result: *, success: boolean}|*|{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    cancelObject: async (sigepConfig, plpNumber, trackNumber) => {
        const params = [
            {key: "tipoBloqueio", value: "FRAUDE_BLOQUEIO"},
            {key: "acao", value: "DEVOLVIDO_AO_REMETENTE"},
            {key: "numeroEtiqueta", value: trackNumber},
            {key: "idPlp", value: plpNumber}
        ];

        const response = await Sigep.sigepSoapCall(sigepConfig, SIGEP_METHOD_BLOQUEAR_OBJETO, params, true);
        if (response) {
            try {
                const result = response.result.ns2$bloquearObjetoResponse.return.$t;
                return result.result === "Registro gravado" ? "" : result.result;
            } catch (err) {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: Criar o XML com os dados da PLP que serão enviados aos correios
     *
     * @param sigepConfig
     * @param labels
     * @returns {Promise<string|null>}
     */
    createXMLToClosePLP: async (sigepConfig, labels) => {
        if (labels === null || labels.length === 0) {
            throw new Error("Necessário repassar as etiquetas para entrega aos correios ao fechar uma PLP.");
        } else {
            let xml = `<?xml version="1.0" encoding="ISO-8859-1" ?> 
                        <correioslog>
                          <tipo_arquivo>Postagem</tipo_arquivo> 
                          <versao_arquivo>2.3</versao_arquivo> 
                          <plp>
                            <id_plp />
                            <valor_global />
                            <mcu_unidade_postagem/> <nome_unidade_postagem/> 
                            <cartao_postagem>${sigepConfig.postCard}</cartao_postagem>
                          </plp>
                          <remetente>
                            <numero_contrato>${sigepConfig.contract}</numero_contrato> 
                            <numero_diretoria>${sigepConfig.directorCode}</numero_diretoria> 
                            <codigo_administrativo>${sigepConfig.administrativeCode}</codigo_administrativo> 
                            <nome_remetente>${removeAccents(sigepConfig.senderName)}</nome_remetente> 
                            <logradouro_remetente>${removeAccents(sigepConfig.senderAddress)}</logradouro_remetente> 
                            <numero_remetente>${sigepConfig.senderNumber}</numero_remetente> 
                            <complemento_remetente>${removeAccents(sigepConfig.senderComplement)}</complemento_remetente> 
                            <bairro_remetente>${removeAccents(sigepConfig.senderNeighbor)}</bairro_remetente>
                            <cep_remetente>${sigepConfig.senderZipCode}</cep_remetente>
                            <cidade_remetente>${removeAccents(sigepConfig.senderCity)}></cidade_remetente> 
                            <uf_remetente>${sigepConfig.senderState}</uf_remetente> 
                            <telefone_remetente>${sigepConfig.senderPhone}</telefone_remetente> 
                            <fax_remetente /> 
                            <email_remetente>${sigepConfig.senderEmail}</email_remetente>
                            <celular_remetente>${sigepConfig.senderMobile}</celular_remetente>
                          </remetente>
                        <forma_pagamento />`;

            // Se a lista contem mais de um objeto, a tag <objeto_postal> deverá ser repetida
            labels.map(label => {
                xml += `<objeto_postal> 
                          <numero_etiqueta>${label.trackingCode}</numero_etiqueta> 
                          <codigo_objeto_cliente/> 
                          <codigo_servico_postagem>${label.serviceCode}</codigo_servico_postagem> 
                          <cubagem>0,00</cubagem>
                          <peso>${label.labelWeight ? label.labelWeight : "0" }</peso>
                          <rt1>${label.remarks}</rt1>
                          <rt2/>
                          <destinatario>
                            <nome_destinatario>${removeAccents(label.name)}</nome_destinatario> 
                            <telefone_destinatario>${label.phone}</telefone_destinatario> 
                            <celular_destinatario>${label.phone}</celular_destinatario> 
                            <email_destinatario>${label.email}</email_destinatario> 
                            <logradouro_destinatario>${removeAccents(label.address)}</logradouro_destinatario> 
                            <complemento_destinatario>${removeAccents(label.addressComplement)}</complemento_destinatario> 
                            <numero_end_destinatario>${label.addressNumber}</numero_end_destinatario>
                          </destinatario>
                          <nacional>
                            <bairro_destinatario>${removeAccents(label.addressNeighbor)}</bairro_destinatario> 
                            <cidade_destinatario>${removeAccents(label.addressCity)}</cidade_destinatario> 
                            <uf_destinatario>${label.addressState}</uf_destinatario> 
                            <cep_destinatario>${label.addressZipCode}</cep_destinatario> 
                            <codigo_usuario_postal/>
                            <centro_custo_cliente/>
                            <numero_nota_fiscal>${label.invoice && label.invoice !== "" && label.invoice !== "null" ? label.invoice.padStart(5, "0") : "00000"}</numero_nota_fiscal>
                            <serie_nota_fiscal/>
                            <valor_nota_fiscal>${label.invoiceValue ? label.invoiceValue : "0,00"}</valor_nota_fiscal>
                            <natureza_nota_fiscal/> 
                            <descricao_objeto /> 
                            <valor_a_cobrar>${label.chargeValue ? label.chargeValue : "0,00"}</valor_a_cobrar>
                          </nacional>
                          <servico_adicional> 
                            <codigo_servico_adicional>025</codigo_servico_adicional>`;

                if (label.arriveNotice === "S") {
                    xml += ` <codigo_servico_adicional>${SERVICE_DELIVERED_NOTICE}</codigo_servico_adicional>`;
                }

                if (label.inHands === "S") {
                    xml += `<codigo_servico_adicional>${SERVICE_IN_HANDS}</codigo_servico_adicional>`;
                }

                if (label.declaredValue === "S") {
                    const code = label.serviceDescription.includes("SEDEX")
                        ? SERVICE_DECLARED_VALUE_SEDEX
                        : SERVICE_DECLARED_VALUE_PAC;

                    xml += `<codigo_servico_adicional>${code}</codigo_servico_adicional>`;
                }

                xml += `<valor_declarado>${label.insuranceValue ? label.insuranceValue : "0,00"}</valor_declarado>
                          </servico_adicional>
                          <dimensao_objeto>
                            <tipo_objeto>${"00" + label.objectType}</tipo_objeto> 
                            <dimensao_altura>${label.labelHeight ? label.labelHeight : "16"}</dimensao_altura> 
                            <dimensao_largura>${label.labelWidth ? label.labelWidth : "16"}</dimensao_largura>  
                            <dimensao_comprimento>${label.labelLength ? label.labelLength : "16"}</dimensao_comprimento> 
                            <dimensao_diametro>${label.labelDiameter ? label.labelDiameter : "16"}</dimensao_diametro>
                          </dimensao_objeto>
                          <data_postagem_sara/> 
                          <status_processamento>0</status_processamento>
                          <numero_comprovante_postagem/>
                          <valor_cobrado/>
                        </objeto_postal>`;
            });

            xml += `</correioslog>`;
            return xml.replace(/(\r\n|\n|\r)/gm, "");
        }
    }
};

function removeAccents(text) {
    const accents = "áéíóúàèìòùãõñâêîôûçüÁÉÍÓÚÀÈÌÒÙÃÕÑÂÊÎÔÛÇÜ";
    const normal = "aeiouaeiouaonaeioucuAEIOUAEIOUAONAEIOUCU";
    let result = "";
    for (let i = 0; i < text.length; i++) {
        let pos = accents.indexOf(text.substr(i, 1));

        if (pos === -1) {
            result += text.substr(i, 1);
        } else {
            result += normal.substr(pos, 1);
        }
    }

    return result;
}