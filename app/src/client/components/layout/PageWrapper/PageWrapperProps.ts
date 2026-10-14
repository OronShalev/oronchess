import { CSSProperties, ReactNode } from "react";

interface PageWrapperProps {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
    contentClassName?: string;
    contentStyle?: CSSProperties;
}

export default PageWrapperProps;