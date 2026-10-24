// The Deriv chart fills whatever box it is placed in (phone or laptop). On a phone it uses the
// chart's own phone layout, with the drawing tools down the left and the price scale on the right.
const TradingViewComponent = () => {
    return (
        <iframe
            id='trading-view-iframe'
            title='TradingView Chart'
            style={{ display: 'block', width: '100%', height: '100%', border: 0, backgroundColor: 'white' }}
            src='https://charts.deriv.com/deriv?hide-signup=true'
        />
    );
};

export default TradingViewComponent;
