const soapRequest = require("easy-soap-request");
'use strict';
const XMLMapping = require("xml-mapping");

// Protocol SOAP
export const Soap = {
    /**
     *
     * Objetivo: fazer chamadas genéricas em SOAP
     *
     * @param url: endereço do servidor SOAP
     * @param xml: conteúdo a ser enviado ao servidor SOAP
     * @param username: caso a autenticação senha por usuário e senha
     * @param password: caso a autenticação senha por usuário e senha
     * @returns {Promise<{result: *, success: boolean}|{result: string, success: boolean}>}
     */
    soapCall: async (url, xml, username = "", password = "") => {
        try {
            let headers = {
                "Content-Type": "text/xml;charset=UTF-8"
            };

            if (username !== "" && password !== "") {
                headers = {
                    "Content-Type": "text/xml;charset=UTF-8",
                    Authorization:
                        "Basic " + Buffer.from(username + ":" + password).toString("base64")
                };
            }

            const { response } = await soapRequest(url, headers, xml, 12000);
            const { body, statusCode } = response;

            if (statusCode !== 200) {
                return {
                    success: false,
                    result: "statusCode: " + statusCode.toString()
                };
            } else {
                return {
                    success: true,
                    result: body
                };
            }
        } catch (err) {
            if (typeof err === "string") {
                const json = XMLMapping.load(err);
                throw new Error(json.soap$Envelope.soap$Body.soap$Fault.faultstring.$t);
            } else {
                throw new Error(err.message);
            }
        }
    },

    /**
     *
     * Objetivo: fazer chamadas genéricas em SOAP e retornar em JSON
     *
     * @param url: endereço do servidor SOAP
     * @param xml: conteúdo a ser enviado ao servidor SOAP
     * @param username: caso a autenticação senha por usuário e senha
     * @param password: caso a autenticação senha por usuário e senha
     * @returns {Promise<{result: *, success: boolean}|{result: *, success: boolean}|{result: string, success: boolean}|{result: string, success: boolean}>}
     */
    soapCallJsonResult: async (url, xml, username = "", password = "") => {
        const response = await Soap.soapCall(url, xml, username, password);

        if (response) {
            if (response.success === true) {
                try {
                    const json = XMLMapping.load(response.result);
                    return json.soap$Envelope.soap$Body;
                } catch (err) {
                    try {
                        const json = XMLMapping.load(response.result);
                        return json.soapenv$Envelope.soapenv$Body;
                    } catch (err) {
                        throw new Error(err.message);
                    }
                }
            } else {
                return response;
            }
        } else {
            throw new Error("Não foi possível obter resultados do serviço.");
        }
    }
};
