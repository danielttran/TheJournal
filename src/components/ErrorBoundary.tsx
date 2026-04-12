"use client";

import React, { Component, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

/**
 * Error Boundary component to catch rendering errors and prevent white screen crashes.
 * Displays a user-friendly error message with recovery options.
 */
export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught error:', error, errorInfo);
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoBack = () => {
        this.setState({ hasError: false, error: null });
        window.history.back();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="flex items-center justify-center min-h-screen bg-bg-app p-8">
                    <div className="max-w-md w-full bg-bg-card border border-border-primary rounded-lg p-6 shadow-lg">
                        <div className="flex items-center space-x-3 mb-4">
                            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                                <span className="text-red-500 text-xl">⚠</span>
                            </div>
                            <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
                        </div>

                        <p className="text-text-secondary text-sm mb-4">
                            An unexpected error occurred. Your data has been saved automatically.
                        </p>

                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <pre className="bg-bg-active p-3 rounded text-xs text-red-400 overflow-auto mb-4 max-h-32">
                                {this.state.error.message}
                            </pre>
                        )}

                        <div className="flex space-x-3">
                            <button
                                onClick={this.handleGoBack}
                                className="flex-1 px-4 py-2 border border-border-primary rounded text-text-secondary hover:bg-bg-hover transition-colors"
                            >
                                Go Back
                            </button>
                            <button
                                onClick={this.handleReload}
                                className="flex-1 px-4 py-2 bg-accent-primary text-white rounded hover:bg-opacity-90 transition-colors"
                            >
                                Reload Page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
