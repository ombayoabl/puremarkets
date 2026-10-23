// Removed unused React import - React 17+ JSX transform doesn't require it
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { v4 as uuidv4 } from 'uuid';
import { useStore } from '@/hooks/useStore';
import Chart from './chart';
import './chart.scss';

interface ChartWrapperProps {
    prefix?: string;
    show_digits_stats: boolean;
    barriers?: any[];
    force_light?: boolean;
}

const ChartWrapper = observer(({ prefix = 'chart', show_digits_stats, barriers, force_light }: ChartWrapperProps) => {
    const { client } = useStore();
    const [uuid] = useState(uuidv4());

    const uniqueKey = client.loginid ? `${prefix}-${client.loginid}` : `${prefix}-${uuid}`;

    return <Chart key={uniqueKey} show_digits_stats={show_digits_stats} barriers={barriers} force_light={force_light} />;
});

export default ChartWrapper;
