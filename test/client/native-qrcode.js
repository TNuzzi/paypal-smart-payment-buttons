/* @flow */
/* eslint require-await: off, max-lines: off, max-nested-callbacks: off */

import { wrapPromise, uniqueID, parseQuery } from 'belter/src';
import { ZalgoPromise } from 'zalgo-promise/src';
import { FUNDING, PLATFORM } from '@paypal/sdk-constants/src';

import { promiseNoop } from '../../src/lib';

import { mockSetupButton, mockAsyncProp, createButtonHTML, clickButton,
    getNativeFirebaseMock, getGraphQLApiMock, generateOrderID, mockFunction } from './mocks';

describe('native qrcode cases', () => {

    it('should render a button with createOrder, click the button, and render checkout via qrcode path', async () => {
        return await wrapPromise(async ({ expect, avoid }) => {
            window.xprops.enableNativeCheckout = true;
            window.xprops.platform = PLATFORM.MOBILE;
            delete window.xprops.onClick;

            const sessionToken = uniqueID();

            const gqlMock = getGraphQLApiMock({
                extraHandler: expect('firebaseGQLCall', ({ data }) => {
                    if (!data.query.includes('query GetFireBaseSessionToken')) {
                        return;
                    }

                    if (!data.variables.sessionUID) {
                        throw new Error(`Expected sessionUID to be passed`);
                    }

                    return {
                        data: {
                            firebase: {
                                auth: {
                                    sessionUID: data.variables.sessionUID,
                                    sessionToken
                                }
                            }
                        }
                    };
                })
            }).expectCalls();

            let sessionUID;

            mockFunction(window.paypal, 'QRCode', expect('QRCode', ({ original, args: [ props ] }) => {
                const query = parseQuery(props.qrPath.split('?')[1]);
                sessionUID = query.sessionUID;
                return original(props);
            }));

            const { expect: expectSocket, onInit, onApprove } = getNativeFirebaseMock({
                getSessionUID: () => {
                    if (!sessionUID) {
                        throw new Error(`Session UID not present`);
                    }

                    return sessionUID;
                },
                extraHandler: expect('extraHandler', ({ message_name, message_type }) => {
                    if (message_name === 'onInit' && message_type === 'request') {
                        ZalgoPromise.delay(50).then(onApprove);
                    }
                })
            });

            const mockWebSocketServer = expectSocket();

            const orderID = generateOrderID();
            const payerID = 'XXYYZZ123456';

            window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                return ZalgoPromise.try(() => {
                    return orderID;
                });
            }), 50);

            window.xprops.onCancel = avoid('onCancel');

            window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                if (data.orderID !== orderID) {
                    throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                }

                if (data.payerID !== payerID) {
                    throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                }
            }));

            const fundingEligibility = {
                venmo: {
                    eligible: true
                }
            };

            createButtonHTML({ fundingEligibility });

            await mockSetupButton({
                eligibility: {
                    cardFields: false,
                    native:     true
                }
            });

            await clickButton(FUNDING.VENMO);
            await ZalgoPromise.delay(50).then(onInit);
            await window.xprops.onApprove.await();

            await mockWebSocketServer.done();
            gqlMock.done();
        });
    });

    it('should render a button with createOrder, click the button, and render checkout via qrcode path with onClick rejecting', async () => {
        return await wrapPromise(async ({ expect, avoid }) => {
            window.xprops.enableNativeCheckout = true;
            window.xprops.platform = PLATFORM.MOBILE;
            delete window.xprops.onClick;

            const QRCode = window.paypal.QRCode;
            mockFunction(window.paypal, 'QRCode', avoid('QRCode', QRCode));

            window.xprops.createOrder = mockAsyncProp(avoid('createOrder', uniqueID));

            window.xprops.onClick = mockAsyncProp(expect('onClick', async (data, actions) => {
                return actions.reject();
            }), 50);

            window.xprops.onCancel = mockAsyncProp(avoid('onCancel', promiseNoop));
            window.xprops.onApprove = mockAsyncProp(avoid('onApprove', promiseNoop));

            const fundingEligibility = {
                venmo: {
                    eligible: true
                }
            };

            createButtonHTML({ fundingEligibility });

            await mockSetupButton({
                eligibility: {
                    cardFields: false,
                    native:     true
                }
            });

            await clickButton(FUNDING.VENMO);
        });
    });
});